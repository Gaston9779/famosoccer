/**
 * Club-intelligence competitions. Player pools (ITA/FRA) deliberately do not
 * appear here: they describe recruitment populations, not target leagues.
 */
export const CLUB_COMPETITIONS = {
  UZ1: {
    tmCompetitionId: "UZ1",
    displayName: "Uzbekistan Super League",
    country: "Uzbekistan",
    currentSeason: "2026",
  },
  IT1: {
    tmCompetitionId: "IT1",
    displayName: "Serie A",
    country: "Italy",
    currentSeason: "2026/27",
  },
  IT2: {
    tmCompetitionId: "IT2",
    displayName: "Serie B",
    country: "Italy",
    currentSeason: "2026/27",
  },
  IT3A: {
    tmCompetitionId: "IT3A",
    displayName: "Serie C - Girone A",
    country: "Italy",
    currentSeason: "2026/27",
  },
  IT3B: { tmCompetitionId: "IT3B", displayName: "Serie C - Girone B", country: "Italy", currentSeason: "2026/27" },
} as const;

export type ClubCompetitionId = keyof typeof CLUB_COMPETITIONS;

export const DEFAULT_CLUB_COMPETITION: ClubCompetitionId = "UZ1";

export function clubCompetition(
  competition: ClubCompetitionId = DEFAULT_CLUB_COMPETITION,
) {
  return CLUB_COMPETITIONS[competition];
}

export function isClubCompetitionId(value: string): value is ClubCompetitionId {
  return value in CLUB_COMPETITIONS;
}

/** Resolves untrusted route-query input without ever falling back across leagues. */
export function clubCompetitionFromSearchParam(
  value: string | string[] | undefined,
): ClubCompetitionId {
  const competition = Array.isArray(value) ? value[0] : value;
  return competition && isClubCompetitionId(competition)
    ? competition
    : DEFAULT_CLUB_COMPETITION;
}

export function clubCompetitionWhere(competition: ClubCompetitionId) {
  return { competition: { tmCompetitionId: competition } };
}

export function competitionSeasonMatches(
  value: string,
  competition: ClubCompetitionId,
) {
  const season = clubCompetition(competition).currentSeason;
  if (value === season) return true;
  // PlayerPerformance stores the current Serie C season under the canonical
  // application year, while TMAPI returns it as a compact European season.
  if ((competition === "IT3A" || competition === "IT3B") && value === "2026") return true;
  // Transfermarkt uses both compact and expanded European-season formats.
  return season === "2026/27" && (value === "26/27" || value === "2026/27");
}
