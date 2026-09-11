import { clamp, daysBetween, round, scoringConfig } from "./config";
import { normalizeRole } from "./roles";
import { playerAge, type IntelligencePlayer } from "./types";
import type { Representation } from "../transfermarkt/types";
import { playingTimePercent, selectCurrentPerformance } from "../current-performance";
export type Component = { score: number | null; maxScore: number; status: "KNOWN" | "UNKNOWN"; reason: string; warning?: string };
export type OpportunitySportingScope = "UZ1" | "ITA";
const known = (score: number, maxScore: number, reason: string, warning?: string): Component => ({ score, maxScore, status: "KNOWN", reason, ...(warning ? { warning } : {}) });
const unknown = (maxScore: number, reason: string): Component => ({ score: null, maxScore, status: "UNKNOWN", reason, warning: reason });
export function scoreContractOpportunity(
  contractExpires: Date | null,
  now: Date,
  confirmedFreeAgent = false,
  // Retain the legacy fourth argument for existing callers; a missing club is
  // intentionally no longer evidence of availability.
  _clubId: string | null = null,
  careerStatus: "ACTIVE" | "FREE_AGENT" | "RETIRED" | "UNKNOWN" = "UNKNOWN",
): Component {
  // A retired player must not be treated as an available free agent, even if
  // an older record still carries the confirmed-free-agent flag.
  if (
    careerStatus !== "RETIRED" &&
    (confirmedFreeAgent || careerStatus === "FREE_AGENT")
  )
    return known(35, 35, "Free agent: immediately available");
  if (!contractExpires || !Number.isFinite(contractExpires.getTime()))
    return unknown(35, "Contract expiry unavailable");
  const days = daysBetween(contractExpires, now);
  if (days < 0)
    return known(0, 35, "Contract expiry date has passed", "Contract date is in the past; current status requires verification");
  const score =
    days < 180
      ? 32
      : days <= 365
        ? 28
        : days <= 420
          ? 24
          : days <= 547
            ? 12
            : days <= 730
              ? 5
              : 0;
  const reason =
    days < 180
      ? "Contract expires within 6 months"
      : days <= 365
        ? "Contract expires within 12 months"
        : days <= 420
          ? "Contract expires in approximately 12–14 months"
          : days <= 547
            ? "Contract expires in approximately 14–18 months"
            : days <= 730
              ? "Contract expires in approximately 18–24 months"
              : "Contract expires in more than 24 months";
  return known(score, 35, reason);
}
export function scoreRepresentationOpportunity(
  status: Representation,
): Component {
  if (status === "UNKNOWN") return unknown(30, "Representation unavailable");
  const score = {
    NO_AGENT: 30,
    FAMILY: 28,
    NOT_LISTED: 23,
    AGENCY: 0,
  }[status];
  return known(
    score,
    30,
    `Representation ${status}: +${score}`,
    status === "NOT_LISTED"
      ? "Agent field not listed; this does not mean no agent"
      : undefined,
  );
}
export function scorePlayingTime(pct: number | null | undefined): Component {
  if (pct == null || !Number.isFinite(pct) || pct < 0 || pct > 100)
    return unknown(15, "Playing time unavailable");
  const score = pct < 10 ? 0 : pct < 25 ? 3 : pct < 50 ? 8 : pct < 75 ? 12 : 15;
  return known(score, 15, `${pct.toFixed(1)}% of league minutes: +${score}`);
}
export const scorePlayingTimeOpportunity = scorePlayingTime;
export function scoreAgeOpportunity(age: number | null): Component {
  if (age === null || !Number.isFinite(age) || age < 0)
    return unknown(10, "Age unavailable");
  if (age < 18)
    return known(0, 10, "Under 18: +0", "Minor player");
  const score =
    age <= 21 ? 10 : age <= 24 ? 8 : age <= 27 ? 5 : age <= 30 ? 2 : 0;
  return known(score, 10, `Age ${age}: +${score}`);
}
export function scoreMarketAccessibility(value: number | null): Component {
  if (value === null || !Number.isFinite(value) || value < 0)
    return unknown(10, "Market value unavailable");
  const score =
    value <= 100000
      ? 10 : value <= 250000 ? 9 : value <= 500000 ? 8 : value <= 750000 ? 7 : value <= 1000000 ? 6 : value <= 2000000 ? 4 : value <= 3000000 ? 3 : value <= 5000000 ? 2 : 1;
  return known(score, 10, `Market value €${value}: accessibility +${score}`);
}
export function currentScoringPerformance<T extends IntelligencePlayer>(
  player: T,
  season: string | null,
  _now: Date,
  scope: OpportunitySportingScope = "UZ1",
): T["performances"][number] | null {
  if (scope === "UZ1" && (!season || season === "UNVERIFIED")) return null;
  return selectCurrentPerformance(player.performances, scope);
}
export function calculateConfidence(components: Component[] | IntelligencePlayer, season?: string | null, now?: Date) {
  const values = Array.isArray(components) ? components : [
    scoreContractOpportunity(components.contractExpires, now!, components.confirmedFreeAgent, components.clubId, components.careerStatus),
    scoreRepresentationOpportunity(components.representationStatus),
    scorePlayingTime(currentScoringPerformance(components, season ?? null, now!)?.minutesPlayedPercent),
    scoreAgeOpportunity(playerAge(components, now!)),
    scoreMarketAccessibility(components.marketValueEur),
  ];
  const knownMaxScoreSum = values.filter((c) => c.status === "KNOWN").reduce((sum, c) => sum + c.maxScore, 0);
  return {
    // Compatibility for callers that consume this helper as a coverage summary.
    total: knownMaxScoreSum,
    knownMaxScoreSum,
    confidence: knownMaxScoreSum / 100,
    reasons: values.map((c) => `${c.maxScore}-point ${c.reason}: ${c.status}`),
  };
}
export function adjustOpportunity(rawOpportunity: number | null, confidence: number): number | null {
  if (rawOpportunity === null) return null;
  return round(50 + (rawOpportunity - 50) * confidence);
}
export function calculatePlayerOpportunity(
  player: IntelligencePlayer,
  season: string | null,
  now: Date,
  scope: OpportunitySportingScope = "UZ1",
) {
  const performance = currentScoringPerformance(player, season, now, scope);
  const components = [
    scoreContractOpportunity(
      player.contractExpires,
      now,
      player.confirmedFreeAgent,
      player.clubId,
      player.careerStatus,
    ),
    scoreRepresentationOpportunity(player.representationStatus),
    scorePlayingTime(playingTimePercent(performance)),
    scoreAgeOpportunity(playerAge(player, now)),
    scoreMarketAccessibility(player.marketValueEur),
  ];
  const coverage = calculateConfidence(components);
  const knownScoreSum = components.reduce((sum, component) => sum + (component.status === "KNOWN" ? component.score ?? 0 : 0), 0);
  const rawOpportunity = coverage.knownMaxScoreSum
    ? round(knownScoreSum / coverage.knownMaxScoreSum * 100)
    : null;
  const adjustedOpportunity = adjustOpportunity(rawOpportunity, coverage.confidence);
  const warnings = components.flatMap((c) => (c.warning ? [c.warning] : []));
  if (!player.profileLastSyncedAt)
    warnings.push("Profile not imported; score is provisional");
  if (
    performance &&
    daysBetween(now, performance.sourceUpdatedAt) >
      scoringConfig.performanceFreshDays
  )
    warnings.push("Performance data is stale");
  if (normalizeRole(player.mainPosition) === "UNKNOWN")
    warnings.push("Main role unavailable");
  return {
    // `total` is the product score: confidence-adjusted, not raw known-data score.
    total: adjustedOpportunity,
    rawOpportunity,
    adjustedOpportunity,
    knownScoreSum,
    knownMaxScoreSum: coverage.knownMaxScoreSum,
    contractScore: components[0].score,
    representationScore: components[1].score,
    playingTimeScore: components[2].score,
    ageScore: components[3].score,
    marketAccessibilityScore: components[4].score,
    confidence: coverage.confidence,
    confidenceReasons: coverage.reasons,
    reasons: components.map((c) => c.reason),
    warnings,
  };
}
