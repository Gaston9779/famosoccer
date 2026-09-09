import { db } from "../db";
import { normalizeRole } from "../scoring/roles";

export type CoverageScope = "ALL" | "UZ1" | "OTHER" | "EXACT_ROLE_COVERED";
const filled = (value: string | null) => Boolean(value?.trim());
const hasNationality = (value: string) => {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) && parsed.some((item) => typeof item === "string" && item.trim()); }
  catch { return false; }
};

export async function playerCoverage(scope: CoverageScope = "EXACT_ROLE_COVERED") {
  const rows = await db.player.findMany({ include: { club: { include: { competition: true } }, performances: { select: { id: true } }, opportunityHistory: { where: { isCurrent: true }, select: { id: true } } } });
  const players = rows.filter((p) => {
    const uz1 = p.club?.competition?.tmCompetitionId === "UZ1";
    return scope === "ALL" || (scope === "UZ1" && uz1) || (scope === "OTHER" && !uz1) || (scope === "EXACT_ROLE_COVERED" && uz1 && normalizeRole(p.mainPosition) !== "UNKNOWN");
  });
  const total = players.length;
  const metric = (label: string, presentWhen: (player: typeof players[number]) => boolean) => {
    const present = players.filter(presentWhen).length;
    return { label, present, missing: total - present, total, percentage: total ? present / total * 100 : 0 };
  };
  const metrics = [
    metric("Profile image", p => filled(p.portraitUrl)), metric("Sporting present", p => p.performances.length > 0), metric("Preferred foot", p => p.preferredFoot !== "UNKNOWN"), metric("Height", p => p.heightCm !== null), metric("Nationality", p => hasNationality(p.nationalities)), metric("Main position", p => filled(p.mainPosition)), metric("Exact role", p => normalizeRole(p.mainPosition) !== "UNKNOWN"), metric("Secondary positions", p => filled(p.secondaryPositions)), metric("Market value", p => p.marketValueEur !== null), metric("Contract", p => p.contractExpires !== null), metric("Agency", p => filled(p.agencyName) || filled(p.agentRaw)), metric("Representation", p => p.representationStatus !== "UNKNOWN"), metric("Opportunity", p => p.opportunityHistory.length > 0), metric("Club", p => p.club !== null), metric("Competition", p => p.club?.competition !== null),
  ];
  const count = (predicate: (p: typeof players[number]) => boolean) => players.filter(predicate).length;
  return { scope, total, metrics, distributions: { preferredFoot: { RIGHT: count(p => p.preferredFoot === "RIGHT"), LEFT: count(p => p.preferredFoot === "LEFT"), BOTH: count(p => p.preferredFoot === "BOTH"), UNKNOWN: count(p => p.preferredFoot === "UNKNOWN") }, representation: { NO_AGENT: count(p => p.representationStatus === "NO_AGENT"), FAMILY: count(p => p.representationStatus === "FAMILY"), AGENCY: count(p => p.representationStatus === "AGENCY"), NOT_LISTED: count(p => p.representationStatus === "NOT_LISTED"), UNKNOWN: count(p => p.representationStatus === "UNKNOWN") } } };
}
