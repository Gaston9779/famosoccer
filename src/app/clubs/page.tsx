import Link from "next/link";
import { existsSync, readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { money, PageHeader, Badge } from "@/components/scouting-ui";
import { ClubLogo } from "@/components/media";
import { playerAge } from "@/lib/scoring/types";
import { clubsQueryForCompetition } from "@/lib/intelligence/queries";
import { clubCompetition, clubCompetitionFromSearchParam } from "@/lib/club-competitions";

export const dynamic = "force-dynamic";

function needTone(score: number) {
  if (score >= 60) return "green" as const;
  if (score >= 30) return "amber" as const;
  return "red" as const;
}

export default async function Clubs({
  searchParams,
}: {
  searchParams: Promise<{ competition?: string | string[] }>;
}) {
  const competitionId = clubCompetitionFromSearchParam((await searchParams).competition);
  const competition = clubCompetition(competitionId);
  const clubs = await db.club.findMany({
    ...clubsQueryForCompetition(competitionId),
    select: {
      id: true,
      name: true,
      tmClubId: true,
      players: { select: { birthDate: true, age: true, marketValueEur: true } },
      needHistory: {
        where: { isCurrent: true, available: true },
        orderBy: { total: "desc" },
        take: 1,
        select: { total: true, role: true },
      },
    },
    orderBy: { name: "asc" },
  });
  const syncedPlayers = clubs.reduce((total, club) => total + club.players.length, 0);
  let enrichmentProgress: { profiles: number; performances: number; total: number; updatedAt: string | null } | null = null;
  if (competitionId === "IT3B") {
    const checkpoint = "src/data/import/italy-clubs/checkpoints/it3b_2026_27_enrichment_checkpoint.json";
    if (existsSync(checkpoint)) {
      const data = JSON.parse(readFileSync(checkpoint, "utf8"));
      const states = Object.values(data.players ?? {}) as Array<{ profileStatus: string; performanceStatus: string }>;
      enrichmentProgress = {
        profiles: states.filter((state) => state.profileStatus === "SUCCESS").length,
        performances: states.filter((state) => state.performanceStatus === "SUCCESS").length,
        total: 583,
        updatedAt: data.updatedAt ?? null,
      };
    }
  }

  return <>
    <PageHeader title="Clubs" eyebrow={`${competition.displayName} squad intelligence`} />
    {enrichmentProgress && <p className="muted" style={{ marginBottom: 16 }}>
      Live enrichment progress: {enrichmentProgress.profiles}/{enrichmentProgress.total} profiles · {enrichmentProgress.performances}/{enrichmentProgress.total} performance payloads · {syncedPlayers}/{enrichmentProgress.total} players visible in this workspace{enrichmentProgress.updatedAt ? ` · updated ${new Date(enrichmentProgress.updatedAt).toLocaleTimeString("it-IT")}` : ""}
    </p>}
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
      {clubs.map((club) => {
        const ages = club.players.map((player) => playerAge(player, new Date())).filter((age): age is number => age != null);
        const value = club.players.reduce((total, player) => total + (player.marketValueEur ?? 0), 0);
        const need = club.needHistory[0];

        return <Link href={`/clubs/${club.id}?competition=${competitionId}`} className="card" style={{ padding: 20, textDecoration: "none", color: "inherit" }} key={club.id}>
          <div className="section-title">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ClubLogo name={club.name} tmClubId={club.tmClubId} size="md" />
              <h2>{club.name}</h2>
            </span>
            {need && <Badge tone={needTone(need.total)}>{need.total.toFixed(1)}</Badge>}
          </div>
          <p className="muted">{club.players.length} players · {ages.length ? `Avg. age ${(ages.reduce((sum, age) => sum + age, 0) / ages.length).toFixed(1)}` : "Average age unavailable"}</p>
          <p className="muted">Squad value {value ? money(value) : "—"}</p>
          <p>{need ? <>Highest need: <b>{need.role}</b></> : "Need score unavailable"}</p>
        </Link>;
      })}
    </div>
    {!clubs.length && <p className="empty">No clubs available for {competition.displayName}.</p>}
  </>;
}
