import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadIntelligenceView, topMatches } from "@/lib/intelligence/queries";
import { formatNationality } from "@/lib/presentation";
import { normalizeRole } from "@/lib/scoring/roles";
import { playerAge } from "@/lib/scoring/types";
import { ClubLogo, PlayerAvatar } from "@/components/media";
import { ScoreBadge } from "@/components/scouting-ui";
import { ClubSquadTable } from "@/components/club-squad-table";
import "./club-detail.css";

export const dynamic = "force-dynamic";

const tacticalRoles = [ "ST", "LW", "RW", "AM", "CM", "DM", "LB", "CB", "RB", "GK" ] as const;
const compactMoney = ( value: number ) => value >= 1_000_000 ? `€${ ( value / 1_000_000 ).toFixed( 1 ).replace( /\.0$/, "" ) }m` : value >= 1_000 ? `€${ ( value / 1_000 ).toFixed( value % 1_000 === 0 ? 0 : 1 ).replace( /\.0$/, "" ) }k` : `€${ value }`;
const needTone = ( score: number | null | undefined ) => score == null ? "none" : score >= 60 ? "high" : score >= 30 ? "medium" : "low";
const needLabel = ( score: number | null | undefined ) => score == null ? "No data" : score >= 60 ? "High need" : score >= 30 ? "Medium need" : "Low need";

function NeedPitch ( { needs, unknownCount }: { needs: { role: string; total: number }[]; unknownCount: number } )
{
  const scoreByRole = new Map( needs.map( ( need ) => [ need.role, need.total ] ) );
  return <section className="club-pitch-card" id="club-needs"><header className="club-section-heading"><div><h2>Squad needs by position</h2><p>Visual overview of recruitment needs based on current squad data</p></div><span title="Club Need estimates recruitment priority for each exact role based on current squad depth, contract risk, age risk and market-value depth.">ⓘ How it works</span></header><div className="club-pitch"><div className="pitch-halfway" /><div className="pitch-circle" /><div className="pitch-box pitch-box-top" /><div className="pitch-box pitch-box-bottom" />{ tacticalRoles.map( ( role ) => { const score = scoreByRole.get( role ); const tone = needTone( score ); return <div className={ `pitch-marker pitch-marker-${ role } pitch-marker-${ tone }` } key={ role }><b>{ role }</b><span>{ score == null ? "—" : score.toFixed( 0 ) }</span></div>; } ) }</div><footer className="club-pitch-footer"><div><i className="pitch-dot pitch-dot-high" />High need (≥60)</div><div><i className="pitch-dot pitch-dot-medium" />Medium need (30–59)</div><div><i className="pitch-dot pitch-dot-low" />Low need (&lt;30)</div><div><i className="pitch-dot pitch-dot-none" />No data</div>{ unknownCount > 0 && <p>{ unknownCount } players without an exact role</p> }</footer></section>;
}

export default async function Club ( { params }: { params: Promise<{ id: string }> } )
{
  const { id } = await params;
  const [ club, view, currentPlayers ] = await Promise.all( [
    db.club.findUnique( { where: { id }, include: { competition: true, players: { include: { opportunityHistory: { where: { isCurrent: true }, take: 1 } }, orderBy: { name: "asc" } }, needHistory: { where: { isCurrent: true, available: true }, orderBy: { role: "asc" } } } } ),
    loadIntelligenceView( true ),
    db.player.findMany( { where: { club: { competition: { tmCompetitionId: "UZ1" } } }, include: { club: true } } ),
  ] );
  if ( !club ) notFound();
  const matches = await topMatches( view, { clubId: id, limit: 5 } );
  const playerById = new Map( currentPlayers.map( ( player ) => [ player.id, player ] ) );
  const ages = club.players.map( ( player ) => playerAge( player, new Date() ) ).filter( ( age ): age is number => age != null );
  const totalValue = club.players.reduce( ( total, player ) => total + ( player.marketValueEur ?? 0 ), 0 );
  const country = formatNationality( club.competition?.country );
  const unknownCount = club.players.filter( ( player ) => normalizeRole( player.mainPosition ) === "UNKNOWN" ).length;

  return <div className="club-detail-page">
    <header className="club-detail-header"><div className="club-identity"><p className="club-breadcrumb"><Link href="/clubs">Clubs</Link><span>›</span>{ club.name }</p><div><ClubLogo name={ club.name } tmClubId={ club.tmClubId } size="lg" /><section><h1>{ club.name }</h1><p>{ club.competition?.name ?? "Competition unavailable" } <span>{ country.flag } { country.code }</span></p></section></div></div><div className="club-kpis">{ [ [ "Squad size", club.players.length, "players" ], [ "Average age", ages.length ? ( ages.reduce( ( total, age ) => total + age, 0 ) / ages.length ).toFixed( 1 ) : "—", ages.length ? "known ages" : "No age data" ], [ "Estimated value", totalValue ? compactMoney( totalValue ) : "—", totalValue ? "known values" : "No value data" ] ].map( ( [ label, value, note ] ) => <article key={ String( label ) }><span>{ label }</span><strong>{ value }</strong><small>{ note }</small></article> ) }</div></header>
    <nav className="club-detail-tabs" aria-label="Club detail sections"><a href="#overview">Overview</a><a href="#squad">Squad</a><a href="#club-needs" className="active">Club needs</a><a href="#target-players">Target players</a><a href="#matches">Matches</a></nav>
    <main className="club-main-grid" id="overview"><NeedPitch needs={ club.needHistory } unknownCount={ unknownCount } /><section className="club-recommendations" id="target-players"><header className="club-section-heading"><div><h2>Recommended players</h2><p>Best matching players for { club.name }&apos;s needs</p></div><Link href="/opportunities?tab=matches">View all →</Link></header><div>{ matches.map( ( match ) => { const player = playerById.get( match.playerId ); const nationality = formatNationality( player?.nationalities ); return <Link href={ `/players/${ match.playerId }` } className="club-recommendation-row" key={ `${ match.playerId }-${ match.clubId }-${ match.role }` }><PlayerAvatar name={ match.playerName } portraitUrl={ player?.portraitUrl } /><span><strong>{ match.playerName }</strong><small>{ match.role }{ player ? ` · ${ playerAge( player, new Date() ) ?? "Age unavailable" }${ playerAge( player, new Date() ) != null ? " years old" : "" }` : "" }</small><em>{ player?.club ? <><ClubLogo name={ player.club.name } tmClubId={ player.club.tmClubId } />{ player.club.name }</> : "Current club unavailable" }</em></span><i>{ nationality.flag } { nationality.code }</i><div><small>Match</small><ScoreBadge score={ match.matchScore } /></div></Link>; } ) }</div>{ !matches.length && <p className="empty">No eligible recommendations.</p> }</section></main>
    <div id="matches" className="club-squad-anchor"><ClubSquadTable clubName={ club.name } players={ club.players.map( ( player ) => ( { id: player.id, name: player.name, portraitUrl: player.portraitUrl, nationality: player.nationalities, age: playerAge( player, new Date() ), role: normalizeRole( player.mainPosition ), contract: player.contractExpires?.toISOString().slice( 0, 10 ) ?? null, marketValue: player.marketValueEur, representation: player.representationStatus, agency: player.agencyName, opportunity: player.opportunityHistory[ 0 ]?.total ?? null } ) ) } /></div>
  </div>;
}
