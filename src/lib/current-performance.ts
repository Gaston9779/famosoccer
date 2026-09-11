export type CurrentPerformanceScope = "UZ1" | "ITA";

export type CurrentPerformance = {
  season: string;
  competitionKey: string;
  minutesPlayed?: number | null;
  possibleGames?: number | null;
  minutesPlayedPercent?: number | null;
};

export function selectCurrentPerformance<T extends CurrentPerformance>(
  performances: readonly T[],
  scope: CurrentPerformanceScope,
): T | null {
  if (scope === "UZ1")
    return performances.find(
      (performance) =>
        performance.season === "2026" && performance.competitionKey === "UZ1",
    ) ?? null;

  return (performances
    .filter(
      (performance) =>
        performance.season === "26/27" || performance.season === "2026/27",
    )
    .sort(
      (a, b) => (b.minutesPlayed ?? -1) - (a.minutesPlayed ?? -1),
    )[0] ?? null) as T | null;
}

export function playingTimePercent(
  performance: Pick<CurrentPerformance, "minutesPlayedPercent" | "minutesPlayed" | "possibleGames"> | null | undefined,
): number | null {
  const stored = performance?.minutesPlayedPercent;
  if (stored !== null && stored !== undefined && Number.isFinite(stored))
    return stored >= 0 && stored <= 100 ? stored : null;

  const minutes = performance?.minutesPlayed;
  const possibleGames = performance?.possibleGames;
  if (
    minutes === null ||
    minutes === undefined ||
    possibleGames === null ||
    possibleGames === undefined ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(possibleGames) ||
    minutes < 0 ||
    possibleGames <= 0
  )
    return null;

  // Matches the derivation already used by the TMAPI performance parser.
  const derived = minutes / (possibleGames * 90) * 100;
  return Number.isFinite(derived) && derived >= 0 && derived <= 100
    ? derived
    : null;
}
