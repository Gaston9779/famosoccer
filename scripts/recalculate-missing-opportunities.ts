import "dotenv/config";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { isClubCompetitionId, type ClubCompetitionId } from "../src/lib/club-competitions";

/**
 * Backfills PlayerOpportunityHistory for candidate players in a target
 * competition that have never had one persisted. Uses the existing,
 * unchanged single-player persistence path (calculateAndPersistPlayerOpportunity),
 * the same one used by manual Transfermarkt import. No formula/weights change.
 *
 *   npm run recalculate:missing-opportunities -- IT1
 *   npm run recalculate:missing-opportunities -- IT2
 */

async function main() {
  const competition = process.argv[2];
  if (!competition || !isClubCompetitionId(competition))
    throw new Error("Usage: recalculate-missing-opportunities.ts <UZ1|IT1|IT2>");
  const comp = competition as ClubCompetitionId;

  const candidates = await db.player.findMany({
    where: { club: { competition: { tmCompetitionId: comp } } },
    select: { id: true, name: true, opportunityHistory: { where: { isCurrent: true }, select: { id: true } } },
  });
  const missing = candidates.filter((p) => p.opportunityHistory.length === 0);

  console.log(JSON.stringify({
    event: "MISSING_OPPORTUNITY_RECALC_START",
    competition: comp,
    candidatePlayers: candidates.length,
    withOpportunity: candidates.length - missing.length,
    missingOpportunity: missing.length,
  }));

  const CONCURRENCY = 8;
  let done = 0;
  let failed = 0;
  const errors: { id: string; name: string; error: string }[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
    while (next < missing.length) {
      const player = missing[next++];
      try {
        await calculateAndPersistPlayerOpportunity(player.id);
        done++;
      } catch (error) {
        failed++;
        errors.push({ id: player.id, name: player.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  await Promise.all(workers);

  const after = await db.player.count({
    where: { club: { competition: { tmCompetitionId: comp } }, opportunityHistory: { some: { isCurrent: true } } },
  });

  console.log(JSON.stringify({
    event: "MISSING_OPPORTUNITY_RECALC_COMPLETE",
    competition: comp,
    attempted: missing.length,
    succeeded: done,
    failed,
    errors: errors.slice(0, 20),
    candidatePlayersWithOpportunityAfter: after,
    candidatePlayersTotal: candidates.length,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
