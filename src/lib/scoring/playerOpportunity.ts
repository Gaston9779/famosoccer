import { clamp, daysBetween, scoringConfig } from "./config";
import { normalizeRole } from "./roles";
import { playerAge, type IntelligencePlayer } from "./types";
import type { Representation } from "../transfermarkt/types";
export type Component = { score: number; reason: string; warning?: string };
export function scoreContractOpportunity(
  contractExpires: Date | null,
  now: Date,
  confirmedFreeAgent = false,
  clubId: string | null = null,
): Component {
  if (confirmedFreeAgent && clubId === null)
    return { score: 35, reason: "Confirmed free agent: +35" };
  if (!contractExpires || !Number.isFinite(contractExpires.getTime()))
    return {
      score: 0,
      reason: "Contract: +0",
      warning: "Contract data unavailable",
    };
  const days = daysBetween(contractExpires, now);
  if (days < 0)
    return {
      score: 0,
      reason: "Past contract date is not proof of free agency: +0",
      warning:
        "Contract date is in the past; current status requires verification",
    };
  const score =
    days <= 90
      ? 32
      : days <= 180
        ? 28
        : days <= 365
          ? 22
          : days <= 540
            ? 12
            : days <= 730
              ? 5
              : 0;
  return { score, reason: `Contract expires in ${days} days: +${score}` };
}
export function scoreRepresentationOpportunity(
  status: Representation,
): Component {
  const score = {
    NO_AGENT: 30,
    FAMILY: 28,
    NOT_LISTED: 23,
    UNKNOWN: 15,
    AGENCY: 0,
  }[status];
  return {
    score,
    reason: `Representation ${status}: +${score}`,
    ...(status === "NOT_LISTED"
      ? { warning: "Agent field not listed; this does not mean no agent" }
      : status === "UNKNOWN"
        ? { warning: "Representation data unknown" }
        : {}),
  };
}
export function scorePlayingTimeOpportunity(pct: number | null): Component {
  if (pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100)
    return {
      score: 0,
      reason: "Playing time: +0",
      warning: "Playing time unavailable",
    };
  const score = pct < 10 ? 15 : pct < 25 ? 12 : pct < 50 ? 8 : pct < 75 ? 3 : 0;
  return {
    score,
    reason: `${pct.toFixed(2)}% of league minutes: +${score} (commercial availability, not quality)`,
  };
}
export function scoreAgeOpportunity(age: number | null): Component {
  if (age === null || !Number.isFinite(age) || age < 0)
    return { score: 0, reason: "Age: +0", warning: "Age unavailable" };
  if (age < 18)
    return { score: 0, reason: "Under 18: +0", warning: "Minor player" };
  const score =
    age <= 21 ? 10 : age <= 24 ? 8 : age <= 27 ? 5 : age <= 30 ? 2 : 0;
  return { score, reason: `Age ${age}: +${score}` };
}
export function scoreMarketAccessibility(value: number | null): Component {
  if (value === null || !Number.isFinite(value) || value < 0)
    return {
      score: 0,
      reason: "Market accessibility: +0",
      warning: "Market value unavailable",
    };
  const score =
    value <= 100000
      ? 8
      : value <= 500000
        ? 10
        : value <= 1000000
          ? 8
          : value <= 2000000
            ? 5
            : value <= 5000000
              ? 2
              : 0;
  return { score, reason: `Market value €${value}: accessibility +${score}` };
}
export function currentScoringPerformance<T extends IntelligencePlayer>(
  player: T,
  season: string | null,
  now: Date,
): T["performances"][number] | null {
  // Season must come from stored competition/source context, never an arbitrary older row.
  if (!season || season === "UNVERIFIED") return null;
  return (
    player.performances
      .filter(
        (r) =>
          r.competitionCode === "UZ1" &&
          r.season === season &&
          r.sourceUpdatedAt <= now &&
          r.minutesPlayedPercent !== null &&
          Number.isFinite(r.minutesPlayedPercent) &&
          r.minutesPlayedPercent >= 0 &&
          r.minutesPlayedPercent <= 100,
      )
      .sort(
        (a, b) => b.sourceUpdatedAt.getTime() - a.sourceUpdatedAt.getTime(),
      )[0] ?? null
  );
}
export function calculateConfidence(
  player: IntelligencePlayer,
  season: string | null,
  now: Date,
) {
  const reasons: string[] = [];
  let total = 0;
  const add = (n: number, reason: string) => {
    total += n;
    reasons.push(`${reason}: +${n}`);
  };
  const age = player.profileLastSyncedAt
    ? daysBetween(now, player.profileLastSyncedAt)
    : null;
  add(
    age === null || age < 0 ? 0 : age <= 7 ? 25 : age <= 30 ? 18 : 8,
    "Profile freshness",
  );
  add(
    (player.contractExpires && daysBetween(player.contractExpires, now) >= 0) ||
      (player.confirmedFreeAgent && player.clubId === null)
      ? 20
      : 0,
    "Verified contract/status availability",
  );
  add(
    player.representationStatus !== "UNKNOWN" ? 20 : 0,
    "Representation field classification (NOT_LISTED is absence, not no agent)",
  );
  const perf = currentScoringPerformance(player, season, now);
  const perfAge = perf ? daysBetween(now, perf.sourceUpdatedAt) : null;
  const syncAge = player.performanceLastSyncedAt
    ? daysBetween(now, player.performanceLastSyncedAt)
    : null;
  add(
    perfAge !== null &&
      syncAge !== null &&
      syncAge >= 0 &&
      syncAge <= scoringConfig.performanceFreshDays &&
      perfAge <= scoringConfig.performanceFreshDays
      ? 15
      : 0,
    "Current-season performance freshness",
  );
  add(
    normalizeRole(player.mainPosition) !== "UNKNOWN" ? 10 : 0,
    "Known main role",
  );
  add(
    player.marketValueEur !== null && player.marketValueEur >= 0 ? 10 : 0,
    "Market value availability",
  );
  return { total: clamp(total), reasons };
}
export function calculatePlayerOpportunity(
  player: IntelligencePlayer,
  season: string | null,
  now: Date,
) {
  const performance = currentScoringPerformance(player, season, now);
  const components = [
    scoreContractOpportunity(
      player.contractExpires,
      now,
      player.confirmedFreeAgent,
      player.clubId,
    ),
    scoreRepresentationOpportunity(player.representationStatus),
    scorePlayingTimeOpportunity(performance?.minutesPlayedPercent ?? null),
    scoreAgeOpportunity(playerAge(player, now)),
    scoreMarketAccessibility(player.marketValueEur),
  ];
  const confidence = calculateConfidence(player, season, now);
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
    total: clamp(components.reduce((n, c) => n + c.score, 0)),
    contractScore: components[0].score,
    representationScore: components[1].score,
    playingTimeScore: components[2].score,
    ageScore: components[3].score,
    marketAccessibilityScore: components[4].score,
    confidence: confidence.total,
    confidenceReasons: confidence.reasons,
    reasons: components.map((c) => c.reason),
    warnings,
  };
}
