import Link from "next/link";
import "./dashboard.css";
import { ClubLogo, PlayerAvatar } from "@/components/media";
import { ScoreBadge } from "@/components/scouting-ui";
import { dashboardSummary } from "@/lib/intelligence/queries";
import { db } from "@/lib/db";
import { normalizeRole } from "@/lib/scoring/roles";
import { addMonths, daysBetween } from "@/lib/scoring/config";
import { playerCoverage } from "@/lib/intelligence/coverage";
import { CoverageCard } from "@/components/coverage-card";
import { DashboardScopeSelect } from "@/components/dashboard-scope-select";
import { playerScopeFromQuery, playerScopeWhere, type PlayerScope } from "@/lib/services/players";

export const dynamic = "force-dynamic";

type DashboardSearchParams = { scope?: string };

const SCOPE_QUERY_VALUE: Record<PlayerScope, string> = {
  ALL: "all", UZBEKISTAN: "uzbekistan", ITA: "ita", FRA: "fra", OTHER: "other",
};
const SCOPE_EYEBROW: Record<PlayerScope, string> = {
  ALL: "All pools", UZBEKISTAN: "UZ1", ITA: "ITA", FRA: "FRA", OTHER: "Other",
};
const SCOPE_SUBTITLE: Record<PlayerScope, string> = {
  ALL: "Key market insights across every scouted player",
  UZBEKISTAN: "Key market insights for Uzbekistan Super League",
  ITA: "Key market insights for Italian free agents abroad",
  FRA: "Key market insights for French free agents",
  OTHER: "Key market insights for other imported players",
};
/** A performance row counts as "current season" regardless of which pool its player belongs to. */
const isCurrentSeasonPerformance = (perf: { season: string; competitionKey: string }) =>
  (perf.season === "2026" && perf.competitionKey === "UZ1") || perf.season === "26/27" || perf.season === "2026/27";

const coverageTone = (percentage: number) =>
  percentage >= 40 ? "emerald" : percentage >= 20 ? "amber" : "rose";

function CoverageRing({
  label,
  known,
  total,
}: {
  label: string;
  known: number;
  total: number;
}) {
  const percentage = total ? Math.round((known / total) * 100) : 0;
  const tone = coverageTone(percentage);
  return (
    <div className="dashboard-coverage-item">
      <div
        className={`coverage-ring coverage-ring-${tone}`}
        style={{ "--coverage": `${percentage * 3.6}deg` } as React.CSSProperties}
      >
        <span>{percentage}%</span>
      </div>
      <strong>{label}</strong>
      <small>{known} / {total}</small>
    </div>
  );
}

function MetricIcon({ kind }: { kind: "players" | "clubs" | "opportunity" | "contract" | "representation" | "coverage" }) {
  const icon = {
    players: "◉",
    clubs: "▥",
    opportunity: "✦",
    contract: "▤",
    representation: "♧",
    coverage: "◌",
  }[kind];
  return <span className={`dashboard-kpi-icon dashboard-kpi-icon-${kind}`} aria-hidden="true">{icon}</span>;
}

function ListHeader({
  icon,
  title,
  subtitle,
  href,
}: {
  icon: string;
  title: string;
  subtitle: string;
  href: string;
}) {
  return (
    <header className="dashboard-list-header">
      <span className="dashboard-list-icon" aria-hidden="true">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <Link href={href}>View all <span aria-hidden="true">→</span></Link>
    </header>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const { scope: scopeParam } = await searchParams;
  // The dashboard defaults to every scouted player (unlike the /players page,
  // which defaults to the Uzbekistan roster) — "generic" is the point here.
  const scope: PlayerScope = scopeParam ? playerScopeFromQuery(scopeParam) : "ALL";
  const scopeQueryValue = SCOPE_QUERY_VALUE[scope];

  const [data, scopedPlayers, uz1Portraits, uz1Clubs, exactRoleCoverage] = await Promise.all([
    // Top club needs / top matches are an active-UZ1-roster concept and stay
    // scoped to UZ1 regardless of the dashboard's own scope selector.
    dashboardSummary(),
    db.player.findMany({
      where: playerScopeWhere(scope),
      select: {
        id: true, clubId: true, mainPosition: true, birthDate: true, nationalities: true,
        contractExpires: true, marketValueEur: true, representationStatus: true,
        performances: { select: { season: true, competitionKey: true } },
        opportunityHistory: { where: { isCurrent: true }, select: { total: true } },
      },
    }),
    // Lightweight, UZ1-only, just for avatar lookups in the always-UZ1 lists below.
    db.player.findMany({
      where: { club: { is: { competition: { is: { tmCompetitionId: "UZ1" } } } } },
      select: { id: true, portraitUrl: true },
    }),
    db.club.findMany({ where: { competition: { tmCompetitionId: "UZ1" } }, select: { id: true, tmClubId: true } }),
    playerCoverage("EXACT_ROLE_COVERED"),
  ]);

  const portraitByPlayerId = new Map(uz1Portraits.map((player) => [player.id, player.portraitUrl]));
  const clubById = new Map(uz1Clubs.map((club) => [club.id, club]));

  const totalPlayers = scopedPlayers.length;
  const clubCount = new Set(scopedPlayers.flatMap((player) => player.clubId ? [player.clubId] : [])).size;
  const now = new Date();
  const highOpportunityCount = scopedPlayers.filter((player) => {
    const total = player.opportunityHistory[0]?.total;
    return total != null && total >= 70;
  }).length;
  const contractsExpiring12Months = scopedPlayers.filter(
    (player) =>
      player.contractExpires &&
      daysBetween(player.contractExpires, now) >= 0 &&
      player.contractExpires <= addMonths(now, 12),
  ).length;
  const openRepresentationCount = scopedPlayers.filter(
    (player) => player.representationStatus === "NO_AGENT" || player.representationStatus === "FAMILY",
  ).length;
  const knownMainRoles = scopedPlayers.filter((player) => normalizeRole(player.mainPosition) !== "UNKNOWN").length;

  const coverage = [
    ["Exact role", knownMainRoles],
    ["Date of birth", scopedPlayers.filter((p) => p.birthDate).length],
    ["Nationality", scopedPlayers.filter((p) => p.nationalities !== "[]").length],
    ["Contract", scopedPlayers.filter((p) => p.contractExpires).length],
    ["Market value", scopedPlayers.filter((p) => p.marketValueEur != null).length],
    ["Representation", scopedPlayers.filter((p) => p.representationStatus !== "UNKNOWN").length],
    ["Performance", scopedPlayers.filter((p) => p.performances.some(isCurrentSeasonPerformance)).length],
  ] as const;

  const distribution = scopedPlayers.reduce(
    (counts, player) => {
      const score = player.opportunityHistory[0]?.total;
      if (score == null) counts.noData += 1;
      else if (score >= 70) counts.high += 1;
      else if (score >= 40) counts.medium += 1;
      else counts.low += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0, noData: 0 },
  );
  const distributionTotal = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  const distributionStyle = {
    "--high": `${(distribution.high / Math.max(distributionTotal, 1)) * 360}deg`,
    "--medium": `${((distribution.high + distribution.medium) / Math.max(distributionTotal, 1)) * 360}deg`,
    "--low": `${((distribution.high + distribution.medium + distribution.low) / Math.max(distributionTotal, 1)) * 360}deg`,
  } as React.CSSProperties;

  const kpis = [
    { kind: "players" as const, value: totalPlayers, label: "Current players", detail: `in ${clubCount} clubs`, href: null },
    { kind: "clubs" as const, value: clubCount, label: "Clubs", detail: scope === "UZBEKISTAN" ? "Uzbekistan Super League" : "Clubs with a scouted player", href: null },
    { kind: "opportunity" as const, value: highOpportunityCount, label: "High opportunities", detail: "Opportunity score ≥ 70", href: `/players?scope=${scopeQueryValue}&minScore=70` },
    { kind: "contract" as const, value: contractsExpiring12Months, label: "Contracts expiring", detail: "Within 12 months", href: `/players?scope=${scopeQueryValue}&contract=expiring` },
    { kind: "representation" as const, value: openRepresentationCount, label: "Representation opportunities", detail: "No agent or family", href: `/players?scope=${scopeQueryValue}&representation=OPEN` },
    { kind: "coverage" as const, value: `${knownMainRoles} / ${totalPlayers}`, label: "Data coverage", detail: "Exact roles known", href: null },
  ];

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">{SCOPE_EYEBROW[scope]} · Commercial intelligence</p>
          <h1>Scouting dashboard</h1>
          <p>{SCOPE_SUBTITLE[scope]}</p>
        </div>
        <div className="dashboard-hero-context" aria-label="Current dashboard scope">
          <span>Players</span><span>Clubs</span><span>Opportunity</span><span>Market intelligence</span>
        </div>
      </section>

      <DashboardScopeSelect value={scopeQueryValue}>
        <section className="dashboard-kpis" aria-label="Current metrics">
          {kpis.map((kpi) => kpi.kind === "coverage" ? (
            <CoverageCard key={kpi.label} value={String(kpi.value)} coverage={exactRoleCoverage} />
          ) : kpi.href ? (
            <Link className="dashboard-kpi-card dashboard-kpi-card-link" key={kpi.label} href={kpi.href}>
              <div className="dashboard-kpi-value"><MetricIcon kind={kpi.kind} /><strong>{kpi.value}</strong></div>
              <h2>{kpi.label}</h2>
              <p>{kpi.detail}</p>
            </Link>
          ) : (
            <article className="dashboard-kpi-card" key={kpi.label}>
              <div className="dashboard-kpi-value"><MetricIcon kind={kpi.kind} /><strong>{kpi.value}</strong></div>
              <h2>{kpi.label}</h2>
              <p>{kpi.detail}</p>
            </article>
          ))}
        </section>

        <section className="dashboard-analytics">
          <article className="dashboard-analytics-card dashboard-coverage-card">
            <header className="dashboard-card-title">
              <div><span className="dashboard-card-icon" aria-hidden="true">◌</span><div><h2>Data coverage</h2><p>Availability of key data fields across the players in view</p></div></div>
            </header>
            <div className="dashboard-coverage-grid">
              {coverage.map(([label, known]) => <CoverageRing key={label} label={label} known={known} total={totalPlayers} />)}
            </div>
          </article>

          <article className="dashboard-analytics-card dashboard-distribution-card">
            <header className="dashboard-card-title">
              <div><span className="dashboard-card-icon" aria-hidden="true">▥</span><div><h2>Opportunity distribution</h2><p>Across the players in view</p></div></div>
            </header>
            <div className="dashboard-distribution-content">
              <div className="distribution-donut" style={distributionStyle}>
                <div><strong>{totalPlayers}</strong><span>players</span></div>
              </div>
              <dl className="distribution-legend">
                {[
                  ["high", "High (70–100)", distribution.high],
                  ["medium", "Medium (40–69)", distribution.medium],
                  ["low", "Low (0–39)", distribution.low],
                  ["no-data", "No data", distribution.noData],
                ].map(([tone, label, count]) => <div key={String(label)}><dt><i className={`distribution-dot distribution-dot-${tone}`} />{label}</dt><dd>{Math.round((Number(count) / Math.max(distributionTotal, 1)) * 100)}% <span>{count}</span></dd></div>)}
              </dl>
            </div>
          </article>
        </section>

        <section className="dashboard-summaries">
          <article className="dashboard-list-card">
            <ListHeader icon="✦" title="Top player opportunities" subtitle="UZ1 players with the highest commercial opportunity scores" href="/opportunities?tab=players" />
            <div className="dashboard-list">
              {data.topPlayerOpportunities.slice(0, 5).map((opportunity) => {
                return <Link className="dashboard-player-row" href={`/players/${opportunity.playerId}`} key={opportunity.id}>
                  <PlayerAvatar name={opportunity.player.name} portraitUrl={portraitByPlayerId.get(opportunity.playerId) ?? null} />
                  <span><strong>{opportunity.player.name}</strong><small>{opportunity.player.role} · {opportunity.player.clubName ?? "No current club"}</small></span>
                  <ScoreBadge score={opportunity.total} /><b aria-hidden="true">›</b>
                </Link>;
              })}
            </div>
          </article>

          <article className="dashboard-list-card">
            <ListHeader icon="▥" title="Top club needs" subtitle="UZ1 clubs with the highest recruitment need by role" href="/opportunities?tab=needs" />
            <div className="dashboard-list">
              {data.topClubNeeds.slice(0, 5).map((need) => {
                const club = clubById.get(need.clubId);
                return <Link className="dashboard-club-row" href={`/clubs/${need.clubId}`} key={need.id}>
                  <ClubLogo name={need.clubName} tmClubId={club?.tmClubId ?? "0"} />
                  <strong>{need.clubName}</strong><span>{need.role}</span><ScoreBadge score={need.total} /><b aria-hidden="true">›</b>
                </Link>;
              })}
            </div>
          </article>

          <article className="dashboard-list-card">
            <ListHeader icon="↗" title="Top player ↔ club matches" subtitle="Best commercial fits based on UZ1 club needs" href="/opportunities?tab=matches" />
            <div className="dashboard-list">
              {data.topMatches.slice(0, 5).map((match) => {
                return <Link className="dashboard-match-row" href={`/players/${match.playerId}`} key={`${match.playerId}-${match.clubId}-${match.role}`}>
                  <PlayerAvatar name={match.playerName} portraitUrl={portraitByPlayerId.get(match.playerId) ?? null} />
                  <span><strong>{match.playerName}</strong><small>→ {match.clubName}</small></span>
                  <em>{match.role}</em><ScoreBadge score={match.matchScore} /><b aria-hidden="true">›</b>
                </Link>;
              })}
            </div>
          </article>
        </section>
      </DashboardScopeSelect>
    </div>
  );
}
