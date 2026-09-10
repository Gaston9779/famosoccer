import { groupMatchesByPlayer } from "@/lib/intelligence/match-ranking";
import Link from "next/link";
import { db } from "@/lib/db";
import { loadIntelligenceView, topMatches } from "@/lib/intelligence/queries";
import { normalizeRole } from "@/lib/scoring/roles";
import { playerAge } from "@/lib/scoring/types";
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
  const dbStart = Date.now();
  if (tab === "matches") console.log(JSON.stringify({ event: "MATCHES_START" }));
  const [view, players] = await Promise.all([
    loadIntelligenceView(true),
    db.player.findMany({
      where: { club: { competition: { tmCompetitionId: "UZ1" } } },
      include: { club: true, performances: true, opportunityHistory: { where: { isCurrent: true }, take: 1 } },
      orderBy: { name: "asc" },
    }),
  ]);
  if (tab === "matches") console.log(JSON.stringify({ event: "MATCHES_DB_COMPLETE", durationMs: Date.now() - dbStart, players: view.players.length, clubs: view.clubs.length, opportunities: view.opportunities.length, needs: view.needs.length }));
  const scored = players.flatMap((player) => player.opportunityHistory[0]?.total == null ? [] : [player.opportunityHistory[0].total]);
  const averageOpportunity = scored.length ? scored.reduce((total, score) => total + score, 0) / scored.length : null;
  const highOpportunityCount = scored.filter((score) => score >= 70).length;
  const contractsExpiring12Months = players.filter((player) => {
    if (!player.contractExpires) return false;
    const days = Math.ceil((player.contractExpires.getTime() - Date.now()) / 86_400_000);
    return days >= 0 && days <= 365;
  }).length;
  let table: { columns: TableColumn[]; rows: TableRow[] } | null = null;
  let matchRows: MatchRow[] = [];

  if (tab === "needs") {
    table = {
      columns: [{ key: "club", label: "Club" }, { key: "role", label: "Role" }, { key: "score", label: "Need", numeric: true }, { key: "depth", label: "Known depth", numeric: true }, { key: "projected", label: "Projected depth", numeric: true }, { key: "ideal", label: "Ideal depth", numeric: true }, { key: "warnings", label: "Notes" }],
      rows: view.needs.filter((need) => need.available).map((need) => ({ id: need.id, href: `/clubs/${need.clubId}`, values: { club: need.clubName, role: need.role, score: need.total, depth: need.currentDepth, projected: need.projectedDepth12Months, ideal: need.idealDepth, warnings: need.warnings.join("; ") || "—" } })),
    };
  }
  let matchTotal = 0;
  let matchHighQuality = 0;
  if (tab === "matches") {
    const calcStart = Date.now();
    try {
      const databasePlayerMap = new Map(players.map((player) => [player.id, player]));
      const clubMap = new Map(view.clubs.map((club) => [club.id, club]));
      const opportunityMap = new Map(view.opportunities.map((opportunity) => [opportunity.playerId, opportunity.total]));
      // topMatches is O(n log n) after the in-loop-sort fix; asking for "all" is cheap now.
      const allMatches = topMatches(view, { limit: Number.MAX_SAFE_INTEGER });
      matchTotal = allMatches.length;
      matchHighQuality = allMatches.filter((match) => match.matchScore >= 70).length;
      matchRows = groupMatchesByPlayer(allMatches).map(({ bestMatchForPlayer: match, additionalMatches }) => {
        const databasePlayer = databasePlayerMap.get(match.playerId);
        const targetClub = clubMap.get(match.clubId)!;
        return { id: match.playerId, additionalMatches: additionalMatches.map((other) => ({ clubName: other.clubName, role: other.role, matchScore: other.matchScore })), playerId: match.playerId, playerName: match.playerName, portraitUrl: databasePlayer?.portraitUrl ?? null, age: databasePlayer ? playerAge(databasePlayer, new Date()) : null, nationality: databasePlayer?.nationalities ?? "[]", role: match.role, currentClub: databasePlayer?.club ? { id: databasePlayer.club.id, name: databasePlayer.club.name, tmClubId: databasePlayer.club.tmClubId } : null, targetClub: { id: targetClub.id, name: targetClub.name, tmClubId: targetClub.tmClubId }, matchScore: match.matchScore, opportunity: opportunityMap.get(match.playerId) ?? null, contract: databasePlayer?.contractExpires?.toISOString().slice(0, 10) ?? null, marketValue: databasePlayer?.marketValueEur ?? null };
      });
      console.log(JSON.stringify({ event: "MATCHES_CALC_COMPLETE", durationMs: Date.now() - calcStart, players: view.players.length, needs: view.needs.length, matchTotal, matchHighQuality, rowsShipped: matchRows.length }));
    } catch (error) {
      console.error(JSON.stringify({ event: "MATCHES_ERROR", durationMs: Date.now() - calcStart, errorName: error instanceof Error ? error.name : "NonError", errorMessage: error instanceof Error ? error.message : String(error) }));
      throw error; // surface to the route error boundary (src/app/error.tsx)
    }
  }

  if (tab === "matches") {
    console.log(JSON.stringify({ event: "MATCHES_RENDER_COMPLETE", rows: matchRows.length }));
    return <div className="matches-page"><header className="matches-page-header"><p className="eyebrow">Matches</p><h1>Player ↔ Club matches</h1><p>Discover the best fit between players and clubs using our matching algorithm</p></header><section className="matches-kpis" aria-label="Match metrics">{[["⌘", "cyan", matchTotal, "Total matches", "Eligible player–club pairings"], ["✦", "red", matchHighQuality, "High quality matches", "Match score ≥ 70"], ["▥", "teal", view.clubs.length, "Clubs analyzed", "Current UZ1 clubs"], ["◉", "violet", view.players.length, "Players analyzed", "Current UZ1 roster"]].map(([icon, tone, value, label, detail]) => <article key={String(label)}><div><span className={`matches-kpi-icon matches-kpi-icon-${tone}`}>{icon}</span><strong>{value}</strong></div><h2>{label}</h2><p>{detail}</p></article>)}</section><MatchesBrowser rows={matchRows} /></div>;
  }

  return <div className="opportunities-page">
    <header className="opportunities-header"><p className="eyebrow">Opportunities</p><h1>Player opportunities</h1><p>Find undervalued players with high commercial potential</p></header>
    <section className="opportunities-kpis" aria-label="Opportunity metrics">
      {[
        ["✦", "emerald", highOpportunityCount, "High opportunities", "Opportunity score ≥ 70"],
        ["◉", "blue", view.players.length, "Players analyzed", "Current UZ1 roster"],
        ["◌", "amber", averageOpportunity == null ? "—" : averageOpportunity.toFixed(1), "Average opportunity", scored.length ? `${scored.length} scored players` : "No score data"],
        ["▤", "rose", contractsExpiring12Months, "Contracts expiring", "Within 12 months"],
      ].map(([icon, tone, value, label, detail]) => <article className="opportunities-kpi" key={String(label)}><div><MetricIcon icon={String(icon)} tone={String(tone)} /><strong>{value}</strong></div><h2>{label}</h2><p>{detail}</p></article>)}
    </section>
    <nav aria-label="Opportunity views" className="opportunities-tabs">{[["players", "Player opportunities"], ["needs", "Club needs"], ["matches", "Player ↔ Club matches"]].map(([key, label]) => <Link key={key} href={`/opportunities?tab=${key}`} aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""}>{label}</Link>)}</nav>
    {tab === "players" ? <PlayerTable rows={players.map((player) => ({ id: player.id, isFavorite: player.isFavorite, name: player.name, portraitUrl: player.portraitUrl, club: player.club ? { id: player.club.id, name: player.club.name, tmClubId: player.club.tmClubId } : null, role: normalizeRole(player.mainPosition), age: playerAge(player, new Date()), height: player.heightCm, foot: player.preferredFoot, nationality: player.nationalities === "[]" ? null : player.nationalities.replace(/[\[\]"]/g, ""), contract: player.contractExpires?.toISOString().slice(0, 10) ?? null, representation: player.representationStatus, agency: player.agencyName, marketValue: player.marketValueEur, playingTime: player.performances[0]?.minutesPlayedPercent ?? null, opportunity: player.opportunityHistory[0]?.total ?? null, confidence: player.opportunityHistory[0]?.confidence ?? null }))} /> : <section className="opportunities-table-panel"><IntelligenceTable key={tab} label={tab === "needs" ? "Club needs" : "Player club matches"} columns={table!.columns} rows={table!.rows} /></section>}
  </div>;
}
