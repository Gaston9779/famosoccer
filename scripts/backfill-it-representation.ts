import "dotenv/config";
// Reuse the existing profile fetch/parse path (fetchPlayerProfile -> parseProfile),
// pointed at the Italian domain these players' canonical URLs actually live on.
// Unconditional: .env pins TM_BASE_URL to the .com domain for the rest of the app.
process.env.TM_BASE_URL = "https://www.transfermarkt.it";
import { db } from "../src/lib/db";
import { hasValidTmPlayerId } from "../src/lib/services/player-enrichment";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { configNumber } from "../src/lib/transfermarkt/rateLimiter";
import type { RepresentationStatus } from "../src/generated/prisma/client";

/**
 * Representation-only backfill for players currently at an IT1/IT2 club whose
 * representationStatus is still UNKNOWN. Fetches ONLY the Transfermarkt profile
 * page (no performance/transfer/club/squad/market-history requests) and writes
 * ONLY agentRaw/agencyName/representationStatus — every other profile field the
 * parser returns (name, birthDate, contract, market value, current club, ...)
 * is discarded. A fetch/parse failure leaves the row untouched (stays UNKNOWN).
 *
 * Resumable by construction: eligible players are re-queried by
 * `representationStatus = UNKNOWN` on every run, so a run that stops partway
 * (budget exhausted, error) just leaves fewer UNKNOWN rows for the next run to
 * pick up — no separate checkpoint file needed.
 *
 * Respects the same daily request budget as enrich-players.ts
 * (TM_DAILY_MAX_REQUESTS, shared across all Transfermarkt scripts via SyncRun
 * totals for today) so this can't blow past the app's anti-block rate limit.
 *
 *   npm run backfill:it-representation -- --limit=10
 */

const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);
const requestedLimit = limitArg ? Number(limitArg) : 10;
if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error("--limit must be a positive integer");

type Row = {
  name: string;
  tmPlayerId: string;
  competition: string;
  club: string | null;
  before: RepresentationStatus;
  agentRaw: string | null;
  agencyName: string | null;
  after: RepresentationStatus | "ERROR";
  error?: string;
};

async function main() {
  const eligibleWhere = {
    representationStatus: "UNKNOWN" as const,
    club: { is: { competition: { is: { tmCompetitionId: { in: ["IT1", "IT2"] } } } } },
  };
  const totalEligible = await db.player.count({ where: eligibleWhere });

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const usedToday = await db.syncRun.aggregate({
    where: { startedAt: { gte: dayStart } },
    _sum: { requestsAttempted: true },
  });
  const dailyRemaining = Math.max(0, configNumber("TM_DAILY_MAX_REQUESTS", 100) - (usedToday._sum.requestsAttempted ?? 0));
  const limit = Math.min(requestedLimit, dailyRemaining);

  if (limit < 1) {
    console.log(JSON.stringify({ skipped: "daily request budget exhausted", totalEligible, dailyRemaining }, null, 2));
    return;
  }

  const candidates = await db.player.findMany({
    where: eligibleWhere,
    select: {
      id: true,
      tmPlayerId: true,
      tmUrl: true,
      name: true,
      representationStatus: true,
      club: { select: { name: true, competition: { select: { tmCompetitionId: true } } } },
    },
    orderBy: { id: "asc" },
    take: limit,
  });

  const rows: Row[] = [];
  const affectedPlayerIds: string[] = [];
  const summary = {
    attempted: candidates.length,
    success: 0,
    represented: 0,
    unrepresented: 0,
    family: 0,
    notListed: 0,
    stillUnknown: 0,
    errors: 0,
  };

  await withSyncLock(async () => {
    const run = await db.syncRun.create({ data: { type: "REPRESENTATION_BACKFILL" } });
    const provider = new TransfermarktProvider(new TransfermarktClient(run.id, candidates.length, undefined, undefined, { noRetries: true }));
    try {
      for (const player of candidates) {
        const base: Omit<Row, "after" | "error" | "agentRaw" | "agencyName"> = {
          name: player.name,
          tmPlayerId: player.tmPlayerId,
          competition: player.club?.competition?.tmCompetitionId ?? "unknown",
          club: player.club?.name ?? null,
          before: player.representationStatus,
        };
        if (!hasValidTmPlayerId(player.tmPlayerId)) {
          rows.push({ ...base, agentRaw: null, agencyName: null, after: "ERROR", error: "invalid tmPlayerId" });
          summary.errors++;
          continue;
        }
        try {
          const profile = await provider.fetchPlayerProfile(player.tmPlayerId, player.tmUrl);
          await db.player.update({
            where: { id: player.id },
            data: {
              agentRaw: profile.agentRaw,
              agencyName: profile.agencyName,
              representationStatus: profile.representationStatus,
            },
          });
          rows.push({
            ...base,
            agentRaw: profile.agentRaw,
            agencyName: profile.agencyName,
            after: profile.representationStatus,
          });
          summary.success++;
          if (profile.representationStatus === "AGENCY") summary.represented++;
          else if (profile.representationStatus === "NO_AGENT") summary.unrepresented++;
          else if (profile.representationStatus === "FAMILY") summary.family++;
          else if (profile.representationStatus === "NOT_LISTED") summary.notListed++;
          else summary.stillUnknown++;
          if (profile.representationStatus !== "UNKNOWN") affectedPlayerIds.push(player.id);
        } catch (error) {
          // Fetch/parse failure: leave the row untouched (still UNKNOWN), never
          // write NO_AGENT/UNREPRESENTED as a side effect of a failed request.
          rows.push({
            ...base,
            agentRaw: null,
            agencyName: null,
            after: "ERROR",
            error: error instanceof ProviderError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error),
          });
          summary.errors++;
        }
      }
      await finishRun(run.id, undefined, { summary });
    } catch (error) {
      await finishRun(run.id, error, { summary });
      throw error;
    }
  });

  // Representation contributes 30/100 to Opportunity: only recalculate for
  // players whose representation actually changed this run, and only via the
  // existing scorer (weights untouched).
  let opportunityRecalculated = 0;
  for (const playerId of affectedPlayerIds) {
    await calculateAndPersistPlayerOpportunity(playerId);
    opportunityRecalculated++;
  }

  const remainingEligible = await db.player.count({ where: eligibleWhere });
  console.log(JSON.stringify({ totalEligible, dailyRemaining, rows, summary, opportunityRecalculated, remainingEligible }, null, 2));
}

main().finally(() => db.$disconnect());
