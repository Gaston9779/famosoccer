import "dotenv/config";
import { db } from "../src/lib/db";
import { configNumber } from "../src/lib/transfermarkt/rateLimiter";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { BudgetError, ProviderError } from "../src/lib/transfermarkt/errors";
import { saveProfile } from "../src/lib/services/players";
import { finishRun, withSyncLock } from "../src/lib/services/runs";

type PhaseStats = {
  eligible: number;
  attempted: number;
  success: number;
  footFound: number;
  unknown: number;
  failed: number;
  enriched: number;
};

const emptyPhase = (eligible = 0): PhaseStats => ({
  eligible,
  attempted: 0,
  success: 0,
  footFound: 0,
  unknown: 0,
  failed: 0,
  enriched: 0,
});

const currentUz1Where = { club: { competition: { tmCompetitionId: "UZ1" } } };
const dayStart = () => {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  return day;
};

async function main() {
  return withSyncLock(async () => {
    const start = dayStart();
    const dailyCap = configNumber("TM_DAILY_MAX_REQUESTS", 100);
    const usedBefore = await db.syncRun.aggregate({
      where: { startedAt: { gte: start } },
      _sum: { requestsAttempted: true },
    });
    const remainingBudget = Math.max(
      0,
      dailyCap - (usedBefore._sum.requestsAttempted ?? 0),
    );

    const [currentCount, phaseACandidates, phaseBCandidates] = await Promise.all([
      db.player.count({ where: currentUz1Where }),
      db.player.findMany({
        where: {
          ...currentUz1Where,
          profileLastSyncedAt: { not: null },
          preferredFoot: "UNKNOWN",
          preferredFootSyncedAt: null,
        },
        orderBy: { profileLastSyncedAt: "asc" },
      }),
      db.player.findMany({
        where: {
          ...currentUz1Where,
          // A foot-aware successful fetch is sufficient evidence that this
          // profile must not be retried for missing optional profile values.
          profileLastSyncedAt: null,
          preferredFootSyncedAt: null,
        },
        orderBy: { id: "asc" },
      }),
    ]);
    if (currentCount !== 409)
      throw new Error(`Expected 409 current UZ1 players; found ${currentCount}.`);

    const phaseA = emptyPhase(phaseACandidates.length);
    const phaseB = emptyPhase(phaseBCandidates.length);
    const state = {
      currentCount,
      dailyCap,
      usedBefore: usedBefore._sum.requestsAttempted ?? 0,
      phaseA,
      phaseB,
      processed: [] as Array<{
        tmPlayerId: string;
        name: string;
        phase: "A" | "B";
        preferredFoot: string;
        wasProfileEnriched: boolean;
      }>,
    };
    const run = await db.syncRun.create({
      data: { type: "UZ1_PROFILE_ENRICHMENT", metadata: JSON.stringify({ state }) },
    });
    const provider = new TransfermarktProvider(
      new TransfermarktClient(run.id, remainingBudget),
    );
    const persist = () =>
      db.syncRun.update({
        where: { id: run.id },
        data: { metadata: JSON.stringify({ state }) },
      });

    const process = async (
      player: (typeof phaseACandidates)[number],
      phase: "A" | "B",
    ) => {
      const stats = phase === "A" ? phaseA : phaseB;
      const requestCountBefore = await db.syncRun.findUniqueOrThrow({
        where: { id: run.id },
        select: { requestsAttempted: true },
      });
      try {
        const profile = await provider.fetchPlayerProfile(player.tmPlayerId, player.tmUrl);
        await saveProfile(profile);
        await db.player.update({
          where: { tmPlayerId: player.tmPlayerId },
          data: { preferredFootSyncedAt: new Date() },
        });
        stats.success += 1;
        stats.enriched += phase === "B" ? 1 : 0;
        if (profile.preferredFoot === "UNKNOWN") stats.unknown += 1;
        else stats.footFound += 1;
        state.processed.push({
          tmPlayerId: player.tmPlayerId,
          name: player.name,
          phase,
          preferredFoot: profile.preferredFoot,
          wasProfileEnriched: player.profileLastSyncedAt !== null,
        });
      } catch (error) {
        if (
          error instanceof BudgetError ||
          (error instanceof ProviderError &&
            ["BLOCKED", "CIRCUIT_OPEN", "STOPPED", "NETWORK"].includes(error.code))
        )
          throw error;
        stats.failed += 1;
      } finally {
        const requestCountAfter = await db.syncRun.findUniqueOrThrow({
          where: { id: run.id },
          select: { requestsAttempted: true },
        });
        if (requestCountAfter.requestsAttempted > requestCountBefore.requestsAttempted)
          stats.attempted += 1;
        await persist();
      }
    };

    try {
      for (const player of phaseACandidates) await process(player, "A");
      for (const player of phaseBCandidates) await process(player, "B");
      return await finishRun(run.id, undefined, { state });
    } catch (error) {
      return await finishRun(run.id, error, { state });
    }
  });
}

try {
  const run = await main();
  if (["FAILED", "BLOCKED"].includes(run.status)) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
