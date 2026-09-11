import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { selectCurrentPerformance } from "../src/lib/current-performance";

function readLimit(argv: string[]): number | null {
  const index = argv.indexOf("--limit");
  if (index === -1) return null;
  const value = Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("--limit must be a positive integer");
  return value;
}

async function main() {
  const limit = readLimit(process.argv.slice(2));
  const allPlayers = await db.player.findMany({
    where: {
      pools: { some: { poolKey: "ITA" } },
      opportunityHistory: { none: { isCurrent: true } },
    },
    select: { id: true, name: true, performances: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const players = limit === null ? allPlayers : allPlayers.slice(0, limit);

  let succeeded = 0;
  let scored = 0;
  let insufficientData = 0;
  let failed = 0;
  for (const [index, player] of players.entries()) {
    try {
      const result = await calculateAndPersistPlayerOpportunity(player.id);
      const performance = selectCurrentPerformance(player.performances, "ITA");
      const confidence = Math.round(result.confidence * 100);
      console.log(
        `[${index + 1}/${players.length}] ${player.name}\n` +
          `opportunity: ${result.total ?? "—"}\n` +
          `confidence: ${confidence}%\n` +
          `performance: ${performance ? `${performance.season} · ${performance.competitionKey}` : "unavailable"}\n` +
          "result: SUCCESS",
      );
      succeeded++;
      if (result.total === null) insufficientData++;
      else scored++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${index + 1}/${players.length}] ${player.name}\nresult: FAILED\nerror: ${message}`,
      );
      failed++;
    }
  }

  const [currentRows, duplicateGroups] = await Promise.all([
    db.playerOpportunityHistory.count({
      where: { isCurrent: true, player: { pools: { some: { poolKey: "ITA" } } } },
    }),
    db.playerOpportunityHistory.groupBy({
      by: ["playerId"],
      where: { isCurrent: true, player: { pools: { some: { poolKey: "ITA" } } } },
      _count: { _all: true },
      having: { id: { _count: { gt: 1 } } },
    }),
  ]);
  console.log(JSON.stringify({
    eligibleWithoutCurrentOpportunity: allPlayers.length,
    processed: players.length,
    scored,
    insufficientData,
    errors: failed,
    currentOpportunityRows: currentRows,
    duplicateCurrentGroups: duplicateGroups.length,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
