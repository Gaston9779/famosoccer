import { db } from "../db";
import { normalizeRole } from "../scoring/roles";
import { addMonths, daysBetween, type KnownRole } from "../scoring/config";
import { playerAge } from "../scoring/types";
import { calculatePlayerClubMatch } from "../scoring/playerClubMatch";
import type { ClubNeed } from "../scoring/clubNeed";
import type { Representation } from "../transfermarkt/types";
export async function loadIntelligenceView(currentUz1Only = false) {
  // Fixed query count, regardless of squad size. Reads never write history or call providers.
  const [players, clubs, opportunities, needs] = await db.$transaction([
    db.player.findMany({
      ...(currentUz1Only ? { where: { club: { competition: { tmCompetitionId: "UZ1" } } } } : {}),
      include: { performances: true },
      orderBy: { id: "asc" },
    }),
    db.club.findMany({
      where: { competition: { tmCompetitionId: "UZ1" } },
      orderBy: { id: "asc" },
    }),
    db.playerOpportunityHistory.findMany({
      where: { isCurrent: true },
      orderBy: [{ total: "desc" }, { playerId: "asc" }],
    }),
    db.clubNeedHistory.findMany({
      where: { isCurrent: true },
      orderBy: [{ total: "desc" }, { clubId: "asc" }, { role: "asc" }],
    }),
  ]);
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const clubMap = new Map(clubs.map((c) => [c.id, c]));
  return {
    players,
    clubs,
    opportunities: opportunities.flatMap((row) => {
      const p = playerMap.get(row.playerId);
      return p
        ? [
            {
              ...row,
              reasons: JSON.parse(row.reasonsJson) as string[],
              warnings: JSON.parse(row.warningsJson) as string[],
              confidenceReasons: JSON.parse(
                row.confidenceReasonsJson,
              ) as string[],
              player: {
                id: p.id,
                tmPlayerId: p.tmPlayerId,
                name: p.name,
                role: normalizeRole(p.mainPosition),
                age: playerAge(p, new Date()),
                clubId: p.clubId,
                clubName: p.clubId
                  ? (clubMap.get(p.clubId)?.name ?? null)
                  : null,
                representationStatus: p.representationStatus,
                contractExpires: p.contractExpires,
                profileLastSyncedAt: p.profileLastSyncedAt,
              },
            },
          ]
        : [];
    }),
    needs: needs.map((row) => ({
      ...row,
      role: row.role as KnownRole,
      reasons: JSON.parse(row.reasonsJson) as string[],
      warnings: JSON.parse(row.warningsJson) as string[],
      clubName: clubMap.get(row.clubId)?.name ?? row.clubId,
    })),
  };
}
export type IntelligenceView = Awaited<ReturnType<typeof loadIntelligenceView>>;
export type PlayerFilters = {
  minScore?: number;
  representationStatus?: Representation;
  role?: string;
  club?: string;
  maxAge?: number;
  contractWithinDays?: number;
  sort?:
    | "score_desc"
    | "score_asc"
    | "confidence_desc"
    | "age_asc"
    | "contract_asc";
  limit?: number;
  offset?: number;
};
export function filterPlayerOpportunities(
  view: IntelligenceView,
  filters: PlayerFilters = {},
  now = new Date(),
) {
  const rows = view.opportunities.filter(
    (r) =>
      r.total >= (filters.minScore ?? 0) &&
      (!filters.representationStatus ||
        r.player.representationStatus === filters.representationStatus) &&
      (!filters.role || r.player.role === filters.role) &&
      (!filters.club || r.player.clubId === filters.club) &&
      (filters.maxAge === undefined ||
        (r.player.age !== null && r.player.age <= filters.maxAge)) &&
      (filters.contractWithinDays === undefined ||
        (r.player.contractExpires !== null &&
          daysBetween(r.player.contractExpires, now) >= 0 &&
          daysBetween(r.player.contractExpires, now) <=
            filters.contractWithinDays)),
  );
  rows.sort((a, b) => {
    const sort = filters.sort ?? "score_desc";
    const value =
      sort === "score_asc"
        ? a.total - b.total
        : sort === "confidence_desc"
          ? b.confidence - a.confidence
          : sort === "age_asc"
            ? (a.player.age ?? 999) - (b.player.age ?? 999)
            : sort === "contract_asc"
              ? (a.player.contractExpires?.getTime() ?? Infinity) -
                (b.player.contractExpires?.getTime() ?? Infinity)
              : b.total - a.total;
    return value || a.playerId.localeCompare(b.playerId);
  });
  return {
    total: rows.length,
    items: rows.slice(
      filters.offset ?? 0,
      (filters.offset ?? 0) + (filters.limit ?? 100),
    ),
  };
}
export function filterClubNeeds(
  view: IntelligenceView,
  filters: {
    role?: string;
    minScore?: number;
    club?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const rows = view.needs.filter(
    (r) =>
      r.available &&
      r.total >= (filters.minScore ?? 0) &&
      (!filters.role || r.role === filters.role) &&
      (!filters.club || r.clubId === filters.club),
  );
  return {
    total: rows.length,
    items: rows.slice(
      filters.offset ?? 0,
      (filters.offset ?? 0) + (filters.limit ?? 100),
    ),
    unassessedClubs: view.clubs.filter((c) => !c.lastSyncedAt).length,
  };
}
export function topMatches(
  view: IntelligenceView,
  filters: {
    clubId?: string;
    playerId?: string;
    role?: string;
    minScore?: number;
    limit?: number;
    includeCurrentClub?: boolean;
  } = {},
  now = new Date(),
) {
  const scores = new Map(view.opportunities.map((p) => [p.playerId, p]));
  const limit = filters.limit ?? 50;
  const best: NonNullable<ReturnType<typeof calculatePlayerClubMatch>>[] = [];
  const needs = view.needs.filter(
    (n) =>
      n.available &&
      (!filters.clubId || n.clubId === filters.clubId) &&
      (!filters.role || n.role === filters.role),
  );
  const rosters = new Map(
    view.clubs.map((c) => [
      c.id,
      view.players.filter((p) => p.clubId === c.id),
    ]),
  );
  for (const player of view.players) {
    if (filters.playerId && player.id !== filters.playerId) continue;
    const opportunity = scores.get(player.id);
    if (!opportunity) continue;
    for (const need of needs) {
      const match = calculatePlayerClubMatch(
        player,
        need as ClubNeed,
        opportunity.total,
        rosters.get(need.clubId) ?? [],
        now,
        filters.includeCurrentClub,
      );
      if (match && match.matchScore >= (filters.minScore ?? 0)) {
        match.warnings.push(...opportunity.warnings);
        best.push(match);
        best.sort(
          (a, b) =>
            b.matchScore - a.matchScore ||
            a.playerId.localeCompare(b.playerId) ||
            a.clubId.localeCompare(b.clubId) ||
            a.role.localeCompare(b.role),
        );
        if (best.length > limit) best.pop();
      }
    }
  }
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  const clubNames = new Map(view.clubs.map((c) => [c.id, c.name]));
  const playerClubNames = new Map(
    view.players.map((p) => [p.id, p.clubId ? (clubNames.get(p.clubId) ?? null) : null]),
  );
  return best.map((m) => ({
    ...m,
    playerName: names.get(m.playerId)!,
    clubName: clubNames.get(m.clubId)!,
    currentClubName: playerClubNames.get(m.playerId) ?? null,
  }));
}
export async function listEvents(
  filters: {
    type?: string;
    severity?: string;
    unread?: boolean;
    limit?: number;
  } = {},
) {
  const where = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.unread === undefined
      ? {}
      : { readAt: filters.unread ? null : { not: null } }),
  };
  const limit = filters.limit ?? 50;
  const [players, clubs] = await db.$transaction([
    db.playerEvent.findMany({
      where,
      include: { player: { include: { club: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    db.clubEvent.findMany({
      where,
      include: { club: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
  ]);
  return [
    ...players.map((e) => ({ ...e, entity: "PLAYER" as const })),
    ...clubs.map((e) => ({ ...e, entity: "CLUB" as const })),
  ]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    )
    .slice(0, limit);
}
export async function dashboardSummary() {
  const [view, latestEvents] = await Promise.all([
    loadIntelligenceView(true),
    listEvents({ limit: 10 }),
  ]);
  const now = new Date();
  const expiring = (months: number) =>
    view.players.filter(
      (p) =>
        p.contractExpires &&
        daysBetween(p.contractExpires, now) >= 0 &&
        p.contractExpires <= addMonths(now, months),
    ).length;
  return {
    playerCount: view.players.length,
    highOpportunityCount: view.opportunities.filter((row) => row.total >= 70).length,
    clubCount: view.clubs.length,
    openRepresentationCount: view.players.filter(
      (p) =>
        p.representationStatus === "NO_AGENT" ||
        p.representationStatus === "FAMILY",
    ).length,
    contractsExpiring6Months: expiring(6),
    contractsExpiring12Months: expiring(12),
    topPlayerOpportunities: filterPlayerOpportunities(view, { limit: 10 })
      .items,
    topClubNeeds: filterClubNeeds(view, { limit: 10 }).items,
    topMatches: topMatches(view, { limit: 10 }),
    latestEvents,
    coverage: {
      rostersImported: view.clubs.filter((c) => c.lastSyncedAt).length,
      profilesImported: view.players.filter((p) => p.profileLastSyncedAt)
        .length,
      knownMainRoles: view.players.filter(
        (p) => normalizeRole(p.mainPosition) !== "UNKNOWN",
      ).length,
    },
    warnings: [
      "Scores measure commercial opportunity and roster risk, not player quality.",
      "Club needs exclude unimported rosters; incomplete role coverage is reported explicitly.",
    ],
  };
}
