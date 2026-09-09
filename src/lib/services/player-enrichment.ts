import { normalizeRole } from "../scoring/roles";

export const PROFILE_STALE_DAYS = 30;
export const PERFORMANCE_STALE_DAYS = 7;

export type EnrichmentCandidate = {
  id: string;
  tmPlayerId: string;
  tmUrl: string;
  name: string;
  portraitUrl: string | null;
  birthDate: Date | null;
  age: number | null;
  mainPosition: string | null;
  contractExpires: Date | null;
  marketValueEur: number | null;
  representationStatus: "NO_AGENT" | "FAMILY" | "AGENCY" | "NOT_LISTED" | "UNKNOWN";
  confirmedFreeAgent: boolean;
  profileLastSyncedAt: Date | null;
  performanceLastSyncedAt: Date | null;
  club: { competition: { tmCompetitionId: string } | null } | null;
  performances: { id: string }[];
  opportunityHistory: { id: string }[];
};

export type PlayerEnrichmentPlan = EnrichmentCandidate & {
  isUz1: boolean;
  needsProfile: boolean;
  needsPerformance: boolean;
  needsOpportunity: boolean;
  estimatedRequests: number;
};

const isFresh = (value: Date | null, staleDays: number, now: Date) =>
  value !== null && value.getTime() >= now.getTime() - staleDays * 86_400_000;

export const hasValidTmPlayerId = (tmPlayerId: string) => /^\d+$/.test(tmPlayerId);

export function profileNeedsRefresh(player: EnrichmentCandidate, now = new Date()) {
  return (
    !player.portraitUrl?.trim() ||
    !player.mainPosition ||
    normalizeRole(player.mainPosition) === "UNKNOWN" ||
    (player.birthDate === null && player.age === null) ||
    (!player.confirmedFreeAgent && player.contractExpires === null) ||
    player.representationStatus === "UNKNOWN" ||
    player.marketValueEur === null ||
    !isFresh(player.profileLastSyncedAt, PROFILE_STALE_DAYS, now)
  );
}

export function performanceNeedsRefresh(player: EnrichmentCandidate, now = new Date()) {
  return (
    player.performances.length === 0 ||
    !isFresh(player.performanceLastSyncedAt, PERFORMANCE_STALE_DAYS, now)
  );
}

export function planPlayerEnrichment(
  players: EnrichmentCandidate[],
  now = new Date(),
): PlayerEnrichmentPlan[] {
  return players
    .map((player) => {
      const needsProfile = profileNeedsRefresh(player, now);
      const needsPerformance = performanceNeedsRefresh(player, now);
      const needsOpportunity = player.opportunityHistory.length === 0;
      return {
        ...player,
        isUz1: player.club?.competition?.tmCompetitionId === "UZ1",
        needsProfile,
        needsPerformance,
        needsOpportunity,
        estimatedRequests: Number(needsProfile) + Number(needsPerformance),
      };
    })
    .filter(
      (player) =>
        player.needsProfile || player.needsPerformance || player.needsOpportunity,
    )
    .sort((a, b) => {
      if (a.isUz1 !== b.isUz1) return a.isUz1 ? -1 : 1;
      if (a.needsProfile !== b.needsProfile) return a.needsProfile ? -1 : 1;
      if (a.needsOpportunity !== b.needsOpportunity)
        return a.needsOpportunity ? -1 : 1;
      if (a.needsPerformance !== b.needsPerformance)
        return a.needsPerformance ? -1 : 1;
      return (
        (a.profileLastSyncedAt?.getTime() ?? 0) -
        (b.profileLastSyncedAt?.getTime() ?? 0)
      );
    });
}

export function selectWithinRequestBudget(
  plan: PlayerEnrichmentPlan[],
  maxRequests: number,
  maxPlayers?: number,
) {
  const selected: PlayerEnrichmentPlan[] = [];
  let requests = 0;
  for (const player of plan) {
    if (maxPlayers !== undefined && selected.length >= maxPlayers) break;
    if (requests + player.estimatedRequests > maxRequests) break;
    selected.push(player);
    requests += player.estimatedRequests;
  }
  return { selected, estimatedRequests: requests };
}
