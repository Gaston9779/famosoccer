import "dotenv/config";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import {
  hasValidTmPlayerId,
  planPlayerEnrichment,
  selectWithinRequestBudget,
} from "../src/lib/services/player-enrichment";
import { markPerformanceChecked, savePerformance, saveProfile } from "../src/lib/services/players";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { BudgetError, ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { configNumber } from "../src/lib/transfermarkt/rateLimiter";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const numberArg = (name: string, fallback?: number) => {
  const raw = args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
};
const maxRequests = numberArg("--max-requests", 100)!;
const maxPlayers = numberArg("--max-players");

type Summary = {
  totalPlayers: number;
  eligiblePlayers: number;
  missingPortrait: number;
  missingPerformance: number;
  missingOpportunity: number;
  staleProfiles: number;
  estimatedPlayersWith100Requests: number;
  requestsUsed: number;
  playersProcessed: number;
  profileUpdated: number;
  portraitAdded: number;
  performanceUpdated: number;
  opportunityRecalculated: number;
  scoreRecalculated: number;
  partial: number;
  failed: number;
  skipped: number;
  remainingEligible: number;
  coverageBefore: Coverage;
  coverageAfter?: Coverage;
};

type Coverage = {
  exactRoles: number;
  portraits: number;
  performance: number;
  opportunity: number;
  scoring: number;
};

const select = {
  id: true,
  tmPlayerId: true,
  tmUrl: true,
  name: true,
  portraitUrl: true,
  birthDate: true,
  age: true,
  mainPosition: true,
  contractExpires: true,
  marketValueEur: true,
  representationStatus: true,
  confirmedFreeAgent: true,
  profileLastSyncedAt: true,
  performanceLastSyncedAt: true,
  club: { select: { competition: { select: { tmCompetitionId: true } } } },
  performances: { select: { id: true }, take: 1 },
  opportunityHistory: { where: { isCurrent: true }, select: { id: true }, take: 1 },
} as const;

async function coverage(): Promise<Coverage> {
  const players = await db.player.findMany({ select });
  return {
    exactRoles: players.filter((player) => player.mainPosition && player.mainPosition !== "UNKNOWN").length,
    portraits: players.filter((player) => player.portraitUrl?.trim()).length,
    performance: players.filter((player) => player.performances.length > 0).length,
    opportunity: players.filter((player) => player.opportunityHistory.length > 0).length,
    scoring: players.filter((player) => player.opportunityHistory.length > 0).length,
  };
}

async function readPlan() {
  const players = await db.player.findMany({ select });
  const plan = planPlayerEnrichment(players);
  const validPlan = plan.filter((player) => hasValidTmPlayerId(player.tmPlayerId));
  const estimate = selectWithinRequestBudget(validPlan, 100).selected.length;
  return { players, plan, validPlan, estimate };
}

async function main() {
  const [{ players, plan, validPlan, estimate }, coverageBefore] = await Promise.all([
    readPlan(),
    coverage(),
  ]);
  const summary: Summary = {
    totalPlayers: players.length,
    eligiblePlayers: plan.length,
    missingPortrait: players.filter((player) => !player.portraitUrl?.trim()).length,
    missingPerformance: players.filter((player) => player.performances.length === 0).length,
    missingOpportunity: players.filter((player) => player.opportunityHistory.length === 0).length,
    staleProfiles: plan.filter((player) => player.needsProfile && player.profileLastSyncedAt !== null).length,
    estimatedPlayersWith100Requests: estimate,
    requestsUsed: 0,
    playersProcessed: 0,
    profileUpdated: 0,
    portraitAdded: 0,
    performanceUpdated: 0,
    opportunityRecalculated: 0,
    scoreRecalculated: 0,
    partial: 0,
    failed: 0,
    skipped: plan.length - validPlan.length,
    remainingEligible: plan.length,
    coverageBefore,
  };
  const candidates = selectWithinRequestBudget(validPlan, maxRequests, maxPlayers).selected;
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, maxRequests, maxPlayers: maxPlayers ?? null, candidates: candidates.length, ...summary }, null, 2));
    return;
  }

  await withSyncLock(async () => {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const usedToday = await db.syncRun.aggregate({
      where: { startedAt: { gte: dayStart } },
      _sum: { requestsAttempted: true },
    });
    const dailyRemaining = Math.max(0, configNumber("TM_DAILY_MAX_REQUESTS", 100) - (usedToday._sum.requestsAttempted ?? 0));
    const effectiveBudget = Math.min(maxRequests, dailyRemaining);
    const selected = selectWithinRequestBudget(validPlan, effectiveBudget, maxPlayers).selected;
    const run = await db.syncRun.create({
      data: { type: "PLAYER_ENRICHMENT", metadata: JSON.stringify({ summary, maxRequests, effectiveBudget }) },
    });
    const provider = new TransfermarktProvider(new TransfermarktClient(run.id, effectiveBudget));
    const persist = () => db.syncRun.update({ where: { id: run.id }, data: { metadata: JSON.stringify({ summary, maxRequests, effectiveBudget }) } });
    let terminalError: unknown;
    try {
      for (const [index, player] of selected.entries()) {
        const label = `[${index + 1}/${selected.length}] ${player.name}`;
        console.log(`${label} - FETCH`);
        summary.playersProcessed++;
        let partial = false;
        try {
          if (player.needsProfile) {
            const previousPortrait = player.portraitUrl?.trim() ?? null;
            const profile = await provider.fetchPlayerProfile(player.tmPlayerId, player.tmUrl);
            await saveProfile(profile);
            summary.profileUpdated++;
            if (!previousPortrait && profile.portraitUrl?.trim()) summary.portraitAdded++;
            console.log(`${label} - PROFILE UPDATED${!previousPortrait && profile.portraitUrl?.trim() ? " / PORTRAIT ADDED" : ""}`);
          }
          if (player.needsPerformance) {
            try {
              await savePerformance(player.id, await provider.performance(player.tmPlayerId));
              summary.performanceUpdated++;
              console.log(`${label} - PERFORMANCE UPDATED`);
            } catch (error) {
              if (error instanceof ProviderError && error.code === "HTTP" && error.status === 404) {
                await markPerformanceChecked(player.id);
                partial = true;
                console.log(`${label} - PERFORMANCE UNAVAILABLE`);
              } else throw error;
            }
          }
          await calculateAndPersistPlayerOpportunity(player.id);
          summary.opportunityRecalculated++;
          summary.scoreRecalculated++;
          console.log(`${label} - OPPORTUNITY RECALCULATED`);
        } catch (error) {
          if (error instanceof BudgetError || (error instanceof ProviderError && ["BLOCKED", "CIRCUIT_OPEN", "STOPPED", "NETWORK"].includes(error.code))) {
            terminalError = error;
            break;
          }
          summary.failed++;
          partial = true;
          console.log(`${label} - FAILED: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          if (partial) summary.partial++;
          const current = await db.syncRun.findUniqueOrThrow({ where: { id: run.id }, select: { requestsAttempted: true } });
          summary.requestsUsed = current.requestsAttempted;
          await persist();
        }
      }
      const after = await readPlan();
      summary.remainingEligible = after.plan.length;
      summary.coverageAfter = await coverage();
      await finishRun(run.id, terminalError, { summary, maxRequests, effectiveBudget });
    } catch (error) {
      await finishRun(run.id, error, { summary, maxRequests, effectiveBudget });
      throw error;
    }
  });
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} finally {
  await db.$disconnect();
}
