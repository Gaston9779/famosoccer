import Link from "next/link";
import { groupMatchesByPlayer } from "@/lib/intelligence/match-ranking";
import { scoreTone } from "@/lib/score-tone";
import "@/components/match-score.css";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { normalizeRole, secondaryRoles } from "@/lib/scoring/roles";
import { topMatches, loadIntelligenceView } from "@/lib/intelligence/queries";
import { Badge, day, money } from "@/components/scouting-ui";
import { ClubLogo, PlayerAvatar } from "@/components/media";
import { Spinner } from "@/components/spinner";
import { formatCompetitionShortCode } from "@/lib/competition-code";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { playerAge } from "@/lib/scoring/types";
import { currentScoringPerformance, scoreAgeOpportunity, scoreContractOpportunity, scoreMarketAccessibility, scorePlayingTime, scoreRepresentationOpportunity } from "@/lib/scoring/playerOpportunity";
import { formatPercentage, formatRepresentation } from "@/lib/presentation";
import "./detail.css";

export const dynamic = "force-dynamic";

const FOOT_LABEL: Record<string, string> = { RIGHT: "Right foot", LEFT: "Left foot", BOTH: "Both feet" };
const CAREER_LABEL: Record<string, string> = { ACTIVE: "Active", FREE_AGENT: "Free agent", RETIRED: "Retired", UNKNOWN: "Status unknown" };

async function BestClubMatches({ playerId, enabled }: { playerId: string; enabled: boolean }) {
  const view = enabled ? await loadIntelligenceView(true) : null;
  const matches = view ? groupMatchesByPlayer(topMatches(view, { playerId, limit: Number.MAX_SAFE_INTEGER }))[0]?.matches ?? [] : [];
  const clubs = new Map(view?.clubs.map((club) => [club.id, club]) ?? []);
  return <section className="panel">
    <div className="section-title"><h2>Best club matches</h2>{matches.length > 8 && <span className="muted">Top 8 of {matches.length} opportunities</span>}</div>
    {matches.length ? <ol className="best-club-matches">{matches.slice(0, 8).map((match, index) => <li className={`best-club-match ${index === 0 ? "best-club-match-first" : ""}`} key={`${match.clubId}-${match.role}`}>
      <span className="best-club-rank">#{index + 1}</span>
      <Link className="best-club-identity" href={`/clubs/${match.clubId}`}>
        <ClubLogo name={match.clubName} tmClubId={clubs.get(match.clubId)?.tmClubId ?? ""} />
        <strong>{match.clubName}</strong>
      </Link>
      <span className="best-club-role">{match.role}{index === 0 && <small>Best fit</small>}</span>
      <div className="best-club-metrics">
        <div><span>Club need</span><b className={`match-score match-score-${scoreTone(match.clubNeedScore)}`}>{match.clubNeedScore.toFixed(1)}</b></div>
        <div><span>Match score</span><b className={`match-score match-score-${scoreTone(match.matchScore)}`}>{match.matchScore.toFixed(1)}</b></div>
      </div>
    </li>)}</ol> : <p className="empty">{enabled ? "No eligible club matches in current data." : "Club matching is only available for players in the Uzbekistan Super League."}</p>}
  </section>;
}

export default async function PlayerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, competition] = await Promise.all([
    db.player.findUnique({
      where: { id },
      include: {
        club: { include: { competition: true } },
        performances: true,
        opportunityHistory: { where: { isCurrent: true }, take: 1 },
        notes: { orderBy: { createdAt: "desc" } },
        tags: { include: { tag: true } },
      },
    }),
    db.competition.findUnique({ where: { tmCompetitionId: "UZ1" } }),
  ]);
  if (!p) notFound();

  const now = new Date();
  const currentClub = p.careerStatus === "ACTIVE" ? p.club : null;
  const clubContext = currentClub?.name ?? (p.careerStatus === "FREE_AGENT" ? "Free agent" : p.careerStatus === "RETIRED" ? "Retired" : "Club unavailable");
  const leagueCode = formatCompetitionShortCode(currentClub?.competition);
  const role = normalizeRole(p.mainPosition);
  const roleLabel = role === "UNKNOWN" ? "Unknown role" : role;
  const age = playerAge(p, now);
  const secondary = secondaryRoles(p.secondaryPositions).filter((r) => r !== role);
  const footLabel = FOOT_LABEL[p.preferredFoot] ?? null;

  const score = p.opportunityHistory[0];
  const displayScore = score?.total ?? null;
  const confidencePercent = score ? Math.round((score.confidence <= 1 ? score.confidence : score.confidence / 100) * 100) : null;
  const contractComponent = scoreContractOpportunity(p.contractExpires, now, p.confirmedFreeAgent, p.clubId, p.careerStatus);
  const isConfirmedFreeAgent = p.careerStatus === "FREE_AGENT" || p.confirmedFreeAgent;
  const contractMeta = isConfirmedFreeAgent ? "Availability" : "Contract expiry";
  const contractValue = isConfirmedFreeAgent ? "Immediately available" : (p.contractExpires ? day(p.contractExpires) : "Unavailable");
  const scoringPerf = currentScoringPerformance(p, competition?.season ?? null, now);
  const playingTimeComponent = scorePlayingTime(scoringPerf?.minutesPlayedPercent);
  const ageComponent = scoreAgeOpportunity(age);
  const marketComponent = scoreMarketAccessibility(p.marketValueEur);
  const representationComponent = scoreRepresentationOpportunity(p.representationStatus);
  const perf = scoringPerf ? {
    ...scoringPerf,
    startElevenPercent: scoringPerf.startElevenPercent == null ? null : formatPercentage(scoringPerf.startElevenPercent).slice(0, -1),
    minutesPlayedPercent: scoringPerf.minutesPlayedPercent == null ? null : formatPercentage(scoringPerf.minutesPlayedPercent).slice(0, -1),
  } : null;
  const isUz1 = currentClub?.competitionId === competition?.id;
  const hasTransfermarktProfile = /^\d+$/.test(p.tmPlayerId) && /^https?:\/\/(?:www\.)?transfermarkt\.[^/]+\/.+\/profil\/spieler\/\d+(?:[/?#].*)?$/i.test(p.tmUrl);

  const identityChips = [
    age != null ? `${age} yrs` : "Age —",
    p.heightCm ? `${p.heightCm} cm` : null,
    footLabel,
    p.shirtNumber ? `#${p.shirtNumber}` : null,
  ].filter(Boolean) as string[];

  return <>
    <header className="player-detail-header">
      <div className="player-detail-id">
        {currentClub && <ClubLogo name={currentClub.name} tmClubId={currentClub.tmClubId} size="md" />}
        <div className="min-w-0">
          <p className="eyebrow">{`${roleLabel} · ${clubContext}`}{leagueCode ? ` · ${leagueCode}` : ""}</p>
          <h1 className="player-detail-name">{p.name}</h1>
          <div className="player-detail-chips">
            {identityChips.map((chip) => <span key={chip}>{chip}</span>)}
            <span className="player-detail-career">{CAREER_LABEL[p.careerStatus] ?? "Status unknown"}</span>
          </div>
          {secondary.length > 0 && (
            <p className="player-detail-secondary">Also: {secondary.join(" · ")}</p>
          )}
        </div>
      </div>
      <div className="player-detail-actions">
        <PlayerAvatar name={p.name} portraitUrl={p.portraitUrl} size="lg" />
        <FavoriteToggle playerId={p.id} initial={p.isFavorite} />
        {hasTransfermarktProfile
          ? <a className="muted" href={p.tmUrl} target="_blank" rel="noreferrer">Transfermarkt profile ↗</a>
          : <span className="muted">Transfermarkt profile unavailable</span>}
      </div>
    </header>

    <div className="grid kpis" style={{ gridTemplateColumns: "repeat(5,minmax(0,1fr))" }}>
      {[
        ["Market value", money(p.marketValueEur)],
        ["Contract", p.careerStatus === "FREE_AGENT" ? "Free agent" : p.careerStatus === "RETIRED" ? "Retired" : p.careerStatus === "UNKNOWN" ? "Club unavailable" : day(p.contractExpires)],
        ["Representation", formatRepresentation(p.representationStatus, p.agencyName)],
        ["Opportunity", score?.total ?? "—"],
        ["Confidence", confidencePercent === null ? "—" : `${confidencePercent}%`],
      ].map(([label, value]) => (
        <div className="card kpi" key={label as string}><span>{label}</span><b style={{ fontSize: 16 }}>{value}</b></div>
      ))}
    </div>

    <div className="two-col"><section className="mb-5 w-full min-w-0 rounded-2xl border border-slate-700 bg-[#11161e] p-6" style={{gridColumn:"1 / -1"}}><div className="mb-6 grid min-w-0 gap-6 border-b border-slate-700 pb-6 min-[1100px]:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] min-[1100px]:items-center"><div><p className="text-[13px] font-semibold leading-none tracking-[0.18em] text-emerald-400">OPPORTUNITY ANALYSIS</p><h2 className="mt-3.5 text-[36px] font-bold leading-[1.05]">Opportunity Score</h2><p className="mt-5 text-[22px] font-semibold leading-[1.2]">Why this player is an opportunity</p><p className="mt-2 max-w-[720px] text-[14px] leading-[1.5] text-slate-400">Each factor contributes to the commercial Opportunity Score. Colors indicate commercial opportunity, not sporting quality.</p></div>{displayScore!==null&&(()=>{const tone=displayScore>=70?'emerald':displayScore>=40?'amber':'red';const level=displayScore>=70?'HIGH OPPORTUNITY':displayScore>=40?'MEDIUM OPPORTUNITY':'LOW OPPORTUNITY';return <div className="flex min-w-0 items-center gap-4"><div className={`flex h-[104px] w-[104px] shrink-0 flex-col items-center justify-center rounded-full border-4 bg-slate-950 ${tone==='emerald'?'border-emerald-500':tone==='amber'?'border-amber-500':'border-red-500'}`}><b className="text-[32px] font-bold leading-none">{displayScore}</b><span className="mt-1 text-[13px] text-slate-400">/ 100</span></div><div><p className="text-[12px] uppercase tracking-[0.12em] text-slate-400">OPPORTUNITY LEVEL</p><span className={`mt-2 inline-flex min-h-8 items-center whitespace-nowrap rounded px-3.5 text-[12px] font-bold ${tone==='emerald'?'bg-emerald-950 text-emerald-300':tone==='amber'?'bg-amber-950 text-amber-300':'bg-red-950 text-red-300'}`}>{level}</span><p className="mt-2 max-w-[220px] text-[13px] leading-[1.4] text-slate-400">{displayScore>=40?'Interesting profile for a potential market move.':'Limited commercial opportunity at the moment.'}</p></div></div>})()}</div>{displayScore!==null?<><div className="grid grid-cols-1 gap-3 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-5">{[["▤","Contract",contractComponent,contractMeta,contractValue],["◉","Representation",representationComponent,"Representation / Agency",p.representationStatus==='UNKNOWN'?"Unavailable":formatRepresentation(p.representationStatus,p.agencyName)],["▥","Playing time",playingTimeComponent,"Minutes played",perf?.minutesPlayedPercent!=null?`${perf.minutesPlayedPercent}%`:"Unavailable"],["◌","Age",ageComponent,"Player age",age!=null?`${age} years`:"Unavailable"],["◇","Market value",marketComponent,"Market value",p.marketValueEur!=null?money(p.marketValueEur):"Unavailable"]].map(([icon,label,component,meta,value]:any[])=>{const points=component.score,max=component.maxScore,unknown=component.status==='UNKNOWN',pc=unknown?0:Number(points)/max*100;const c=unknown?'slate':pc>=70?'emerald':pc>=40?'amber':'red';const accent=c==='emerald'?'#34d399':c==='amber'?'#fbbf24':c==='red'?'#f87171':'#94a3b8';return <article key={label as string} className="h-[260px] min-h-0 min-w-0 overflow-hidden rounded-xl border border-slate-700 border-t-2 bg-slate-900 p-4" style={{borderTopColor:accent}}><p className="flex items-center gap-2 text-[11px] font-bold uppercase leading-[1.2] tracking-[0.08em] min-[1100px]:whitespace-nowrap" style={{color:accent}}><span aria-hidden="true" className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[18px]">{icon}</span><span>{label}</span></p><p className="mt-[18px] whitespace-nowrap text-[30px] font-bold leading-none" style={{color:accent}}>{unknown?'—':points}<span className="text-[16px] font-medium text-slate-500"> / {max}</span></p><div className="mt-3.5 h-[6px] w-full overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full" style={{width:`${pc}%`,backgroundColor:accent}}/></div><p className="mt-4 h-9 overflow-hidden text-[13px] font-medium leading-[1.35] text-slate-300">{unknown?'Insufficient data':label==='Contract'?component.reason:value==='Unavailable'?'Insufficient data':pc>=70?'Favorable opportunity factor':pc>=40?'Intermediate opportunity factor':'Less favorable factor'}</p><div className="mb-3 mt-3.5 border-t border-slate-700"/><p className="text-[10px] uppercase leading-[1.2] tracking-[0.06em] text-slate-500">{meta}</p><p className="mt-[5px] text-[15px] font-semibold leading-[1.2]">{value}</p></article>})}</div><div className="mt-5 grid min-w-0 gap-4 rounded-xl border border-slate-700 bg-slate-900/50 px-[18px] py-4 min-[1100px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"><div className="min-w-0"><p className="text-[10px] font-semibold tracking-[0.12em] text-slate-400">FACTOR LEGEND</p><div className="mt-3 grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">{[["bg-emerald-400","Favorable","Good for opportunity"],["bg-amber-400","Intermediate","Neutral / mixed"],["bg-red-400","Unfavorable","Less favorable"],["bg-slate-400","Insufficient data","Data unavailable"]].map(([dot,label,description])=><div key={label} className="flex min-w-0 items-start gap-2"><span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`}/><div><p className="text-[12px] font-semibold leading-4 text-slate-200">{label}</p><p className="mt-1 text-[10px] leading-[1.4] text-slate-400">{description}</p></div></div>)}</div></div><div className="flex gap-2 border-t border-slate-700 pt-4 min-[1100px]:border-l min-[1100px]:border-t-0 min-[1100px]:pl-5 min-[1100px]:pt-0"><span aria-hidden="true" className="text-slate-400">ⓘ</span><div><p className="text-[12px] font-semibold leading-[1.4] text-slate-300">Colors indicate commercial opportunity, not sporting quality.</p><p className="mt-1.5 text-[11px] leading-[1.4] text-slate-500">A high Opportunity Score means a potential market opportunity, not a higher sporting level.</p></div></div></div></>:<p className="empty">Opportunity score not available for this player yet.</p>}</section><section className="panel"><div className="section-title"><h2>Sporting</h2></div>{perf?<div className="role-grid">{[['Appearances',perf.gamesPlayed],['Starts',perf.startElevenPercent==null?'—':`${perf.startElevenPercent}%`],['Minutes',perf.minutesPlayed],['Minutes %',perf.minutesPlayedPercent==null?'—':`${perf.minutesPlayedPercent}%`]].map(([label,value])=><div key={label as string}><span>{label}</span><b>{value}</b></div>)}</div>:<p className="empty">No league performance data available yet — insufficient data to assess playing time.</p>}</section></div>

    <Suspense fallback={<section className="panel"><div className="section-title"><h2>Best club matches</h2></div><div className="panel-loading"><Spinner label="Loading club matches" /></div></section>}>
      <BestClubMatches playerId={id} enabled={isUz1} />
    </Suspense>

    <section className="panel">
      <div className="section-title"><h2>Notes and tags</h2></div>
      {p.notes.length ? p.notes.map((note) => <p key={note.id}>{note.content}</p>) : <p className="muted">No notes yet.</p>}
      {p.tags.length > 0 && <p>{p.tags.map((tag) => <Badge key={tag.tagId}>{tag.tag.name}</Badge>)}</p>}
    </section>
  </>;
}
