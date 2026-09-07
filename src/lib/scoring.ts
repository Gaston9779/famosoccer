import { currentLeaguePerformance } from "./transfermarkt/parsers/performance";
import type { Performance, Representation } from "./transfermarkt/types";
type Commercial = {
  representationStatus: Representation;
  contractExpires: Date | null;
  manuallyAdded?: boolean;
};
export function shouldFetchPerformance(player: Commercial, now = new Date()) {
  const horizon = new Date(now);
  horizon.setUTCMonth(horizon.getUTCMonth() + 18);
  return (
    !!player.manuallyAdded ||
    ["NO_AGENT", "FAMILY", "NOT_LISTED", "UNKNOWN"].includes(
      player.representationStatus,
    ) ||
    !!(
      player.contractExpires &&
      player.contractExpires >= now &&
      player.contractExpires <= horizon
    )
  );
}
export function scoringInputs(
  player: Commercial & { performances: Performance[] },
  now = new Date(),
) {
  const performance = currentLeaguePerformance(player.performances, now);
  const pct = performance?.minutesPlayedPercent ?? null;
  const daysUntilContractExpiry = player.contractExpires
    ? Math.ceil((player.contractExpires.getTime() - now.getTime()) / 86400000)
    : null;
  const commercialStatus = ["NO_AGENT", "FAMILY"].includes(
    player.representationStatus,
  )
    ? "OPEN"
    : player.representationStatus === "AGENCY"
      ? daysUntilContractExpiry !== null && daysUntilContractExpiry <= 548
        ? "POSSIBLE"
        : "REPRESENTED"
      : "UNKNOWN";
  const playingTimeBand =
    pct === null
      ? "UNKNOWN"
      : pct < 10
        ? "MARGINAL"
        : pct < 25
          ? "LOW"
          : pct < 50
            ? "ROTATION"
            : pct < 75
              ? "HIGH"
              : "STARTER";
  return {
    daysUntilContractExpiry,
    commercialStatus,
    playingTimeBand,
    currentLeaguePerformance: performance,
    performanceAvailability: performance ? "AVAILABLE" : "UZ1_UNAVAILABLE",
  };
}
