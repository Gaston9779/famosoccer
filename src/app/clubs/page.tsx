import Link from "next/link";
import { db } from "@/lib/db";
import { money, PageHeader, Badge } from "@/components/scouting-ui";
import { ClubLogo } from "@/components/media";
import { playerAge } from "@/lib/scoring/types";
import { clubsQueryForCompetition } from "@/lib/intelligence/queries";
import { clubCompetition, clubCompetitionFromSearchParam } from "@/lib/club-competitions";

export const dynamic = "force-dynamic";

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

  return <>
    <PageHeader title="Clubs" eyebrow={`${competition.displayName} squad intelligence`} />
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
            {need && <Badge tone={need.total >= 70 ? "amber" : "slate"}>{need.total}</Badge>}
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
