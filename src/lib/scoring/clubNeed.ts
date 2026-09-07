import {
  addMonths,
  clamp,
  round,
  scoringConfig,
  type KnownRole,
} from "./config";
import { normalizeRole } from "./roles";
import { playerAge, type IntelligencePlayer } from "./types";
export function calculateClubNeed(
  clubId: string,
  role: KnownRole,
  players: IntelligencePlayer[],
  now: Date,
  rosterSyncedAt: Date | null,
  idealDepth = scoringConfig.idealDepth[role],
) {
  const roster = players.filter((p) => p.clubId === clubId);
  const members = roster.filter((p) => normalizeRole(p.mainPosition) === role);
  const unknownRoleCount = roster.filter(
    (p) => normalizeRole(p.mainPosition) === "UNKNOWN",
  ).length;
  const available = rosterSyncedAt !== null && roster.length > 0;
  const within = (months: number) =>
    members.filter(
      (p) => p.contractExpires && p.contractExpires <= addMonths(now, months),
    ).length;
  const expiring6Months = within(6),
    expiring12Months = within(12),
    currentDepth = members.length,
    projectedDepth12Months = currentDepth - expiring12Months;
  const ages = members
    .map((p) => playerAge(p, now))
    .filter((n): n is number => n !== null);
  const avgAge = ages.length
    ? round(ages.reduce((a, b) => a + b, 0) / ages.length)
    : null;
  const warnings: string[] = [];
  if (!available)
    warnings.push("Roster not imported; club need cannot be assessed");
  if (unknownRoleCount)
    warnings.push(
      `${unknownRoleCount} roster players have unknown main roles; depth shortfall is a conservative lower bound`,
    );
  if (members.some((p) => p.contractExpires === null))
    warnings.push("Missing contracts leave projected depth uncertain");
  if (ages.length < members.length) warnings.push("Some ages unavailable");
  const depthScore = available
    ? round(
        40 *
          clamp(
            (idealDepth - projectedDepth12Months - unknownRoleCount) /
              idealDepth,
            1,
          ),
      )
    : 0;
  const contractRiskScore =
    available && currentDepth
      ? round(
          30 *
            ((0.65 * expiring6Months) / currentDepth +
              (0.35 * expiring12Months) / currentDepth),
        )
      : 0;
  // Composition-wide proportions avoid penalizing a healthy role for one older backup.
  const ageRiskScore =
    available && currentDepth
      ? round(
          20 *
            ((0.5 * ages.filter((a) => a >= 30).length) / currentDepth +
              (0.3 * ages.filter((a) => a >= 33).length) / currentDepth +
              0.2 * (avgAge === null ? 0 : clamp((avgAge - 28) / 7, 1))),
        )
      : 0;
  const values = members
    .map((p) => p.marketValueEur)
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => b - a);
  let qualityDepthScore = 0;
  if (available && values.length >= 2 && unknownRoleCount === 0)
    qualityDepthScore = round(
      10 * clamp((values[0] / values.reduce((a, b) => a + b, 0) - 0.5) * 2, 1),
    );
  else
    warnings.push("Insufficient value/role coverage for the value-depth proxy");
  const reasons = [
    `Projected known depth ${projectedDepth12Months}/${idealDepth}; uncertainty-adjusted depth +${depthScore}`,
    `${expiring6Months}/${currentDepth} contracts at risk within 6 months; ${expiring12Months}/${currentDepth} within 12 months: +${contractRiskScore}`,
    `Average known age ${avgAge ?? "unavailable"}; ${ages.filter((a) => a >= 30).length} aged 30+, ${ages.filter((a) => a >= 33).length} aged 33+: +${ageRiskScore}`,
    `Market value concentration proxy: +${qualityDepthScore}; not a quality assessment`,
  ];
  return {
    clubId,
    role,
    total: round(
      clamp(depthScore + contractRiskScore + ageRiskScore + qualityDepthScore),
    ),
    depthScore,
    contractRiskScore,
    ageRiskScore,
    qualityDepthScore,
    currentDepth,
    projectedDepth12Months,
    idealDepth,
    avgAge,
    expiring6Months,
    expiring12Months,
    unknownRoleCount,
    available,
    reasons,
    warnings,
  };
}
export type ClubNeed = ReturnType<typeof calculateClubNeed>;
