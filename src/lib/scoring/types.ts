import type { Representation } from "../transfermarkt/types";
export interface IntelligencePlayer {
  id: string;
  tmPlayerId: string;
  name: string;
  clubId: string | null;
  mainPosition: string | null;
  secondaryPositions: string | null;
  birthDate: Date | null;
  age: number | null;
  contractExpires: Date | null;
  representationStatus: Representation;
  marketValueEur: number | null;
  profileLastSyncedAt: Date | null;
  performanceLastSyncedAt: Date | null;
  confirmedFreeAgent?: boolean;
  careerStatus?: "ACTIVE" | "FREE_AGENT" | "RETIRED" | "UNKNOWN";
  performances: {
    season: string;
    competitionCode: string | null;
    minutesPlayedPercent: number | null;
    sourceUpdatedAt: Date;
  }[];
}
export function playerAge(
  player: Pick<IntelligencePlayer, "age" | "birthDate">,
  now: Date,
): number | null {
  if (player.birthDate) {
    let age = now.getUTCFullYear() - player.birthDate.getUTCFullYear();
    if (
      now.getUTCMonth() < player.birthDate.getUTCMonth() ||
      (now.getUTCMonth() === player.birthDate.getUTCMonth() &&
        now.getUTCDate() < player.birthDate.getUTCDate())
    )
      age--;
    return age >= 0 && age <= 100 ? age : null;
  }
  return player.age !== null &&
    Number.isInteger(player.age) &&
    player.age >= 0 &&
    player.age <= 100
    ? player.age
    : null;
}
