import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { BudgetError, ProviderError } from "../src/lib/transfermarkt/errors";
import { savePerformance } from "../src/lib/services/players";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { configNumber } from "../src/lib/transfermarkt/rateLimiter";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const missing = args.includes("--missing");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) : undefined;
if (!missing || (limit !== undefined && (!Number.isInteger(limit) || limit < 1)))
  throw new Error("Use --missing [--dry-run] [--limit=N]");

const validTmPlayerId = (id: string) => /^\d+$/.test(id);
const needsPerformance = {
  OR: [
    { performanceLastSyncedAt: null },
    { performances: { none: {} } },
  ],
} satisfies Prisma.PlayerWhereInput;

async function main() {
  const [totalPlayers, missingPlayers, alreadyPopulated, invalidIdentity] = await Promise.all([
    db.player.count(),
    db.player.findMany({ where: needsPerformance, orderBy: { id: "asc" } }),
    db.player.count({ where: { NOT: needsPerformance } }),
    db.player.findMany({ where: needsPerformance, select: { tmPlayerId: true } }),
  ]);
  const noTmPlayerId = invalidIdentity.filter((player) => !validTmPlayerId(player.tmPlayerId)).length;
  const eligibleCandidates = missingPlayers.filter((player) => validTmPlayerId(player.tmPlayerId));
  const eligible = limit === undefined ? eligibleCandidates : eligibleCandidates.slice(0, limit);
  const summary = {
    totalPlayers,
    missingPerformance: missingPlayers.length,
    alreadyPopulated,
    noTmPlayerId,
    eligible: eligible.length,
    processed: 0,
    performanceUpdated: 0,
    performanceUnavailable: 0,
    opportunityRecalculated: 0,
    failed: 0,
    skipped: noTmPlayerId,
  };
  if (dryRun) return console.log(JSON.stringify({ dryRun: true, ...summary }, null, 2));

  return withSyncLock(async () => {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const used = await db.syncRun.aggregate({ where: { startedAt: { gte: start } }, _sum: { requestsAttempted: true } });
    const run = await db.syncRun.create({ data: { type: "PERFORMANCE_ENRICHMENT", metadata: JSON.stringify({ summary }) } });
    const provider = new TransfermarktProvider(new TransfermarktClient(run.id, Math.max(0, configNumber("TM_DAILY_MAX_REQUESTS", 100) - (used._sum.requestsAttempted ?? 0))));
    const persist = () => db.syncRun.update({ where: { id: run.id }, data: { metadata: JSON.stringify({ summary }) } });
    try {
      for (const [index, player] of eligible.entries()) {
        const progress = `[${index + 1}/${eligible.length}] ${player.name}`;
        console.log(`${progress} - FETCH`);
        summary.processed++;
        try {
          const rows = await provider.performance(player.tmPlayerId);
          await savePerformance(player.id, rows);
          summary.performanceUpdated++;
          await calculateAndPersistPlayerOpportunity(player.id);
          summary.opportunityRecalculated++;
          console.log(`${progress} - SUCCESS`);
        } catch (error) {
          if (error instanceof ProviderError && error.code === "HTTP" && error.status === 404) {
            summary.performanceUnavailable++;
            await calculateAndPersistPlayerOpportunity(player.id);
            summary.opportunityRecalculated++;
            console.log(`${progress} - PERFORMANCE_UNAVAILABLE`);
          } else if (error instanceof BudgetError || (error instanceof ProviderError && ["BLOCKED", "CIRCUIT_OPEN", "STOPPED"].includes(error.code))) {
            throw error;
          } else {
            summary.failed++;
            console.log(`${progress} - FAILED`);
          }
        }
        await persist();
      }
      await finishRun(run.id, undefined, { summary });
    } catch (error) {
      await finishRun(run.id, error, { summary });
      throw error;
    }
    console.log(JSON.stringify(summary, null, 2));
  });
}

try { await main(); } finally { await db.$disconnect(); }
