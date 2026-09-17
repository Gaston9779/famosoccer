import "dotenv/config";
import { db } from "../src/lib/db";
import {
  recalculateAllPlayerOpportunities,
  recalculateAllClubNeeds,
  recalculateAllScores,
} from "../src/lib/intelligence/persistence";
import {
  DEFAULT_CLUB_COMPETITION,
  isClubCompetitionId,
} from "../src/lib/club-competitions";
try {
  const command = process.argv[2];
  const requestedCompetition = process.argv[3] ?? DEFAULT_CLUB_COMPETITION;
  if (!isClubCompetitionId(requestedCompetition))
    throw new Error("Competition must be UZ1, IT1, or IT2");
  const result =
    command === "players"
      // This is a deterministic score rebuild. Snapshot generation is a
      // separate concern and made a full correction run unnecessarily serial.
      ? await recalculateAllPlayerOpportunities(new Date(), false, false, 16)
      : command === "players-current"
        ? await recalculateAllPlayerOpportunities(new Date(), true)
      : command === "clubs"
        ? await recalculateAllClubNeeds(requestedCompetition)
        : command === "all"
          ? await recalculateAllScores(new Date(), requestedCompetition)
          : null;
  if (!result) throw new Error("Use players, players-current, clubs or all");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
