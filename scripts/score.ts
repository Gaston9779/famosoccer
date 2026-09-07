import "dotenv/config";
import { db } from "../src/lib/db";
import {
  recalculateAllPlayerOpportunities,
  recalculateAllClubNeeds,
  recalculateAllScores,
} from "../src/lib/intelligence/persistence";
try {
  const command = process.argv[2];
  const result =
    command === "players"
      ? await recalculateAllPlayerOpportunities()
      : command === "clubs"
        ? await recalculateAllClubNeeds()
        : command === "all"
          ? await recalculateAllScores()
          : null;
  if (!result) throw new Error("Use players, clubs or all");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
