import Link from "next/link";
import "./dashboard.css";
import { ClubLogo, PlayerAvatar } from "@/components/media";
import { ScoreBadge } from "@/components/scouting-ui";
import { dashboardSummary } from "@/lib/intelligence/queries";
import { db } from "@/lib/db";
import { normalizeRole } from "@/lib/scoring/roles";
import { playerCoverage } from "@/lib/intelligence/coverage";
import { CoverageCard } from "@/components/coverage-card";

export const dynamic = "force-dynamic";

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

export default async function Home() {
  const [data, players, exactRoleCoverage] = await Promise.all([
    dashboardSummary(),
    db.player.findMany({
      where: { club: { competition: { tmCompetitionId: "UZ1" } } },
      include: {
        club: true,
        performances: true,
        opportunityHistory: { where: { isCurrent: true }, select: { total: true } },
      },
    }),
    playerCoverage("EXACT_ROLE_COVERED"),
  ]);

  const playerById = new Map(players.map((player) => [player.id, player]));
  const clubById = new Map(
    players.flatMap((player) => player.club ? [[player.club.id, player.club] as const] : []),
  );
  const totalPlayers = players.length;
  const coverage = [
    ["Exact role", players.filter((p) => normalizeRole(p.mainPosition) !== "UNKNOWN").length],
    ["Date of birth", players.filter((p) => p.birthDate).length],
    ["Nationality", players.filter((p) => p.nationalities !== "[]").length],
    ["Contract", players.filter((p) => p.contractExpires).length],
    ["Market value", players.filter((p) => p.marketValueEur != null).length],
    ["Representation", players.filter((p) => p.representationStatus !== "UNKNOWN").length],
    ["Performance", players.filter((p) => p.performances.length > 0).length],
  ] as const;
  const distribution = players.reduce(
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

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">UZ1 · Commercial intelligence</p>
          <h1>Scouting dashboard</h1>
          <p>Key market insights for Uzbekistan Super League</p>
        </div>
        <div className="dashboard-hero-context" aria-label="Current dashboard scope">
          <span>Players</span><span>Clubs</span><span>Opportunity</span><span>Market intelligence</span>
        </div>
      </section>

      <section className="dashboard-kpis" aria-label="Current UZ1 metrics">
        {[
          ["players", data.playerCount, "Current players", `in ${data.clubCount} clubs`],
          ["clubs", data.clubCount, "Clubs", "Uzbekistan Super League"],
          ["opportunity", data.highOpportunityCount, "High opportunities", "Opportunity score ≥ 70"],
          ["contract", data.contractsExpiring12Months, "Contracts expiring", "Within 12 months"],
          ["representation", data.openRepresentationCount, "Representation opportunities", "No agent or family"],
          ["coverage", `${data.coverage.knownMainRoles} / ${data.playerCount}`, "Data coverage", "Exact roles known"],
        ].map(([kind, value, label, detail]) => kind === "coverage" ? (
          <CoverageCard key={String(label)} value={String(value)} coverage={exactRoleCoverage} />
        ) : (
          <article className="dashboard-kpi-card" key={String(label)}>
            <div className="dashboard-kpi-value"><MetricIcon kind={kind as Parameters<typeof MetricIcon>[0]["kind"]} /><strong>{value}</strong></div>
            <h2>{label}</h2>
            <p>{detail}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-analytics">
        <article className="dashboard-analytics-card dashboard-coverage-card">
          <header className="dashboard-card-title">
            <div><span className="dashboard-card-icon" aria-hidden="true">◌</span><div><h2>Data coverage</h2><p>Availability of key data fields across all current players</p></div></div>
          </header>
          <div className="dashboard-coverage-grid">
            {coverage.map(([label, known]) => <CoverageRing key={label} label={label} known={known} total={totalPlayers} />)}
          </div>
        </article>

        <article className="dashboard-analytics-card dashboard-distribution-card">
          <header className="dashboard-card-title">
            <div><span className="dashboard-card-icon" aria-hidden="true">▥</span><div><h2>Opportunity distribution</h2><p>Across all current players</p></div></div>
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
          <ListHeader icon="✦" title="Top player opportunities" subtitle="Players with the highest commercial opportunity scores" href="/opportunities?tab=players" />
          <div className="dashboard-list">
            {data.topPlayerOpportunities.slice(0, 5).map((opportunity) => {
              const player = playerById.get(opportunity.playerId);
              return <Link className="dashboard-player-row" href={`/players/${opportunity.playerId}`} key={opportunity.id}>
                <PlayerAvatar name={opportunity.player.name} portraitUrl={player?.portraitUrl} />
                <span><strong>{opportunity.player.name}</strong><small>{opportunity.player.role} · {opportunity.player.clubName ?? "No current club"}</small></span>
                <ScoreBadge score={opportunity.total} /><b aria-hidden="true">›</b>
              </Link>;
            })}
          </div>
        </article>

        <article className="dashboard-list-card">
          <ListHeader icon="▥" title="Top club needs" subtitle="Clubs with the highest recruitment need by role" href="/opportunities?tab=needs" />
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
          <ListHeader icon="↗" title="Top player ↔ club matches" subtitle="Best commercial fits based on club needs" href="/opportunities?tab=matches" />
          <div className="dashboard-list">
            {data.topMatches.slice(0, 5).map((match) => {
              const player = playerById.get(match.playerId);
              return <Link className="dashboard-match-row" href={`/players/${match.playerId}`} key={`${match.playerId}-${match.clubId}-${match.role}`}>
                <PlayerAvatar name={match.playerName} portraitUrl={player?.portraitUrl} />
                <span><strong>{match.playerName}</strong><small>→ {match.clubName}</small></span>
                <em>{match.role}</em><ScoreBadge score={match.matchScore} /><b aria-hidden="true">›</b>
              </Link>;
            })}
          </div>
        </article>
      </section>
    </div>
  );
}
