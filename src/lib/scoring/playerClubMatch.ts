import { clamp, round, scoringConfig, type KnownRole } from "./config";
import { normalizeRole, secondaryRoles } from "./roles";
import { playerAge, type IntelligencePlayer } from "./types";
import type { ClubNeed } from "./clubNeed";
export function calculatePlayerClubMatch(
  player: IntelligencePlayer,
  need: ClubNeed,
  opportunity: number,
  clubPlayers: IntelligencePlayer[],
  now: Date,
  includeCurrentClub = false,
) {
  if (
    !need.available ||
    !player.id ||
    !/^\d+$/.test(player.tmPlayerId) ||
    !player.name.trim() ||
    normalizeRole(player.mainPosition) === "UNKNOWN" ||
    (!includeCurrentClub && player.clubId === need.clubId)
  )
    return null;
  const positionFit =
    normalizeRole(player.mainPosition) === need.role
      ? 100
      : secondaryRoles(player.secondaryPositions).includes(need.role)
        ? 75
        : 0;
  if (!positionFit) return null;
  const age = playerAge(player, now);
  const ageFit =
    age === null
      ? 50
      : age < 18
        ? 0
        : age <= 24
          ? 100
          : age <= 27
            ? 80
            : age <= 30
              ? 55
              : 30;
  const context = clubPlayers
    .filter((p) => p.clubId === need.clubId)
    .map((p) => p.marketValueEur)
    .filter((n): n is number => n !== null && n > 0)
    .sort((a, b) => a - b);
  const warnings = [...need.warnings];
  let marketFit = 50;
  if (age === null) warnings.push("Age unavailable; neutral age fit");
  if (age !== null && age < 18) warnings.push("Minor player");
  if (
    player.marketValueEur !== null &&
    player.marketValueEur >= 0 &&
    context.length >= scoringConfig.minimumMarketContext
  ) {
    const mid = Math.floor(context.length / 2);
    const median =
      context.length % 2 ? context[mid] : (context[mid - 1] + context[mid]) / 2;
    const ratio = player.marketValueEur / median;
    marketFit = ratio <= 1 ? 100 : ratio <= 2 ? 75 : ratio <= 4 ? 50 : 25;
  } else warnings.push("Insufficient market context; neutral market fit 50");
  const matchScore = round(
    clamp(
      0.35 * need.total +
        0.35 * opportunity +
        0.15 * positionFit +
        0.1 * ageFit +
        0.05 * marketFit,
    ),
  );
  return {
    playerId: player.id,
    clubId: need.clubId,
    role: need.role as KnownRole,
    matchScore,
    clubNeedScore: need.total,
    playerOpportunityScore: opportunity,
    positionFit,
    ageFit,
    marketFit,
    reasons: [
      `Club need ${need.total} × 35%`,
      `Opportunity ${opportunity} × 35%`,
      `${positionFit === 100 ? "Main" : "Secondary"} role fit ${positionFit} × 15%`,
      `Age fit ${ageFit} × 10%`,
      `Market fit ${marketFit} × 5%`,
    ],
    warnings,
  };
}
