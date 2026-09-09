import "dotenv/config";
import { db } from "../src/lib/db";
import { recalculateAllPlayerOpportunities } from "../src/lib/intelligence/persistence";

try {
  const limit = Number(process.argv[2] ?? 60);
  const currentRows = await db.playerOpportunityHistory.findMany({
    where: { isCurrent: true },
    select: { playerId: true, reasonsJson: true },
    orderBy: { playerId: "asc" },
  });
  // Legacy rows store the reasons array directly. New rows store the raw and
  // adjusted values in the existing JSON breakdown object.
  const pending = currentRows
    .filter((row) => !row.reasonsJson.trimStart().startsWith("{"))
    .slice(0, limit)
    .map((row) => row.playerId);
  const rows = await recalculateAllPlayerOpportunities(
    new Date(), false, false, 4, new Set(pending),
  );
  console.log(JSON.stringify({ recalculated: rows.length, noData: rows.filter((row) => row.total === null).length, remainingBeforeRun: currentRows.length - pending.length }));
} finally {
  await db.$disconnect();
}
