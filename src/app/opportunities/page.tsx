import Link from "next/link";
import { db } from "@/lib/db";
import { dashboardSummary, loadIntelligenceView, topMatches } from "@/lib/intelligence/queries";
import { normalizeRole } from "@/lib/scoring/roles";
import { playerAge } from "@/lib/scoring/types";
import { formatRepresentation } from "@/lib/presentation";
import { IntelligenceTable, type TableColumn, type TableRow } from "@/components/intelligence-table";
import { PlayerTable } from "@/components/player-table";
import { MatchesBrowser, type MatchRow } from "@/components/matches-browser";
import "../players/players.css";
import "./opportunities.css";
import "./matches.css";

export const dynamic = "force-dynamic";

function MetricIcon({ icon, tone }: { icon: string; tone: string }) {
  return <span className={`opportunities-kpi-icon opportunities-kpi-icon-${tone}`} aria-hidden="true">{icon}</span>;
}

export default async function Opportunities({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: requested } = await searchParams;
  const tab = requested === "needs" || requested === "matches" ? requested : "players";
  const [view, summary, players] = await Promise.all([
    loadIntelligenceView(true),
    dashboardSummary(),
    db.player.findMany({
      where: { club: { competition: { tmCompetitionId: "UZ1" } } },
      include: { club: true, performances: true, opportunityHistory: { where: { isCurrent: true }, take: 1 } },
      orderBy: { name: "asc" },
    }),
  ]);
  const scored = players.flatMap((player) => player.opportunityHistory[0] ? [player.opportunityHistory[0].total] : []);
  const averageOpportunity = scored.length ? scored.reduce((total, score) => total + score, 0) / scored.length : null;
  let table: { columns: TableColumn[]; rows: TableRow[] } | null = null;
  let matchRows: MatchRow[] = [];

  if (tab === "needs") {
    table = {
      columns: [{ key: "club", label: "Club" }, { key: "role", label: "Role" }, { key: "score", label: "Need", numeric: true }, { key: "depth", label: "Known depth", numeric: true }, { key: "projected", label: "Projected depth", numeric: true }, { key: "ideal", label: "Ideal depth", numeric: true }, { key: "warnings", label: "Notes" }],
      rows: view.needs.filter((need) => need.available).map((need) => ({ id: need.id, href: `/clubs/${need.clubId}`, values: { club: need.clubName, role: need.role, score: need.total, depth: need.currentDepth, projected: need.projectedDepth12Months, ideal: need.idealDepth, warnings: need.warnings.join("; ") || "—" } })),
    };
  }
  if (tab === "matches") {
    const playerMap = new Map(view.players.map((player) => [player.id, player]));
    const databasePlayerMap = new Map(players.map((player) => [player.id, player]));
    const clubMap = new Map(view.clubs.map((club) => [club.id, club]));
    const opportunityMap = new Map(view.opportunities.map((opportunity) => [opportunity.playerId, opportunity.total]));
    const matches = topMatches(view, { limit: view.players.length * view.needs.length });
    matchRows = matches.map((match) => {
      const player = playerMap.get(match.playerId)!;
      const databasePlayer = databasePlayerMap.get(match.playerId);
      const targetClub = clubMap.get(match.clubId)!;
      return { id: `${match.playerId}-${match.clubId}-${match.role}`, playerId: match.playerId, playerName: match.playerName, portraitUrl: databasePlayer?.portraitUrl ?? null, age: databasePlayer ? playerAge(databasePlayer, new Date()) : null, nationality: databasePlayer?.nationalities ?? "[]", role: match.role, currentClub: databasePlayer?.club ? { id: databasePlayer.club.id, name: databasePlayer.club.name, tmClubId: databasePlayer.club.tmClubId } : null, targetClub: { id: targetClub.id, name: targetClub.name, tmClubId: targetClub.tmClubId }, matchScore: match.matchScore, opportunity: opportunityMap.get(match.playerId) ?? null, contract: databasePlayer?.contractExpires?.toISOString().slice(0, 10) ?? null, marketValue: databasePlayer?.marketValueEur ?? null };
    });
    table = {
      columns: [{ key: "name", label: "Player" }, { key: "currentClub", label: "Current club" }, { key: "club", label: "Target club" }, { key: "role", label: "Role" }, { key: "representation", label: "Representation" }, { key: "contract", label: "Contract" }, { key: "score", label: "Match", numeric: true }, { key: "opportunity", label: "Opportunity", numeric: true }, { key: "need", label: "Club need", numeric: true }],
      rows: matches.map((match) => {
        const player = playerMap.get(match.playerId)!;
        return { id: `${match.playerId}-${match.clubId}-${match.role}`, href: `/players/${match.playerId}`, links: { club: `/clubs/${match.clubId}`, ...(player.clubId ? { currentClub: `/clubs/${player.clubId}` } : {}) }, values: { name: match.playerName, currentClub: player.clubId ? clubMap.get(player.clubId)?.name ?? null : null, club: match.clubName, role: match.role, representation: formatRepresentation(player.representationStatus), contract: player.contractExpires?.toISOString().slice(0, 10) ?? null, score: match.matchScore, opportunity: opportunityMap.get(match.playerId) ?? null, need: match.clubNeedScore } };
      }),
    };
  }

  if (tab === "matches") {
    const highQuality = matchRows.filter((match) => match.matchScore >= 70).length;
    return <div className="matches-page"><header className="matches-page-header"><p className="eyebrow">Matches</p><h1>Player ↔ Club matches</h1><p>Discover the best fit between players and clubs using our matching algorithm</p></header><section className="matches-kpis" aria-label="Match metrics">{[["⌘", "cyan", matchRows.length, "Total matches", "Current eligible matches"], ["✦", "red", highQuality, "High quality matches", "Match score ≥ 70"], ["▥", "teal", view.clubs.length, "Clubs analyzed", "Current UZ1 clubs"], ["◉", "violet", view.players.length, "Players analyzed", "Current UZ1 roster"]].map(([icon, tone, value, label, detail]) => <article key={String(label)}><div><span className={`matches-kpi-icon matches-kpi-icon-${tone}`}>{icon}</span><strong>{value}</strong></div><h2>{label}</h2><p>{detail}</p></article>)}</section><MatchesBrowser rows={matchRows} /></div>;
  }

  return <div className="opportunities-page">
    <header className="opportunities-header"><p className="eyebrow">Opportunities</p><h1>Player opportunities</h1><p>Find undervalued players with high commercial potential</p></header>
    <section className="opportunities-kpis" aria-label="Opportunity metrics">
      {[
        ["✦", "emerald", summary.highOpportunityCount, "High opportunities", "Opportunity score ≥ 70"],
        ["◉", "blue", view.players.length, "Players analyzed", "Current UZ1 roster"],
        ["◌", "amber", averageOpportunity == null ? "—" : averageOpportunity.toFixed(1), "Average opportunity", scored.length ? `${scored.length} scored players` : "No score data"],
        ["▤", "rose", summary.contractsExpiring12Months, "Contracts expiring", "Within 12 months"],
      ].map(([icon, tone, value, label, detail]) => <article className="opportunities-kpi" key={String(label)}><div><MetricIcon icon={String(icon)} tone={String(tone)} /><strong>{value}</strong></div><h2>{label}</h2><p>{detail}</p></article>)}
    </section>
    <nav aria-label="Opportunity views" className="opportunities-tabs">{[["players", "Player opportunities"], ["needs", "Club needs"], ["matches", "Player ↔ Club matches"]].map(([key, label]) => <Link key={key} href={`/opportunities?tab=${key}`} aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""}>{label}</Link>)}</nav>
    {tab === "players" ? <PlayerTable rows={players.map((player) => ({ id: player.id, name: player.name, portraitUrl: player.portraitUrl, club: player.club ? { id: player.club.id, name: player.club.name, tmClubId: player.club.tmClubId } : null, role: normalizeRole(player.mainPosition), age: playerAge(player, new Date()), nationality: player.nationalities === "[]" ? null : player.nationalities.replace(/[\[\]"]/g, ""), contract: player.contractExpires?.toISOString().slice(0, 10) ?? null, representation: player.representationStatus, agency: player.agencyName, marketValue: player.marketValueEur, playingTime: player.performances[0]?.minutesPlayedPercent ?? null, opportunity: player.opportunityHistory[0]?.total ?? null, confidence: player.opportunityHistory[0]?.confidence ?? null }))} /> : <section className="opportunities-table-panel"><IntelligenceTable key={tab} label={tab === "needs" ? "Club needs" : "Player club matches"} columns={table!.columns} rows={table!.rows} /></section>}
  </div>;
}
