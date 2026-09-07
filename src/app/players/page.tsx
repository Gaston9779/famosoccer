import { db } from "@/lib/db";
import { normalizeRole } from "@/lib/scoring/roles";
import { playerAge } from "@/lib/scoring/types";
import { PlayerTable } from "@/components/player-table";
import "./players.css";
export const dynamic = "force-dynamic";
export default async function Players() {
  const players = await db.player.findMany({ where: { club: { competition: { tmCompetitionId: "UZ1" } } }, include: { club: true, performances: true, opportunityHistory: { where: { isCurrent: true }, take: 1 } }, orderBy: { name: "asc" } });
  return <div className="players-page"><header className="players-page-header"><p className="eyebrow">Players</p><h1>All players</h1><p>Explore {players.length} players from Uzbekistan Super League</p></header><PlayerTable rows={players.map(p => ({ id:p.id, name:p.name, portraitUrl:p.portraitUrl, club:p.club ? {id:p.club.id,name:p.club.name,tmClubId:p.club.tmClubId} : null, role:normalizeRole(p.mainPosition), age:playerAge(p,new Date()), nationality:p.nationalities === "[]" ? null : p.nationalities.replace(/[\[\]"]/g,""), contract:p.contractExpires?.toISOString().slice(0,10) ?? null, representation:p.representationStatus, agency:p.agencyName, marketValue:p.marketValueEur, playingTime:p.performances[0]?.minutesPlayedPercent ?? null, opportunity:p.opportunityHistory[0]?.total ?? null, confidence:p.opportunityHistory[0]?.confidence ?? null }))}/></div>;
}
