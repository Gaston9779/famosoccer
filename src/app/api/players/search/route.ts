import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeRole } from "@/lib/scoring/roles";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json([]);
  const players = await db.player.findMany({
    // The app-shell search is global. Scope belongs to the contextual table.
    where: { name: { contains: query, mode: "insensitive" } },
    take: 8,
    orderBy: { name: "asc" },
    select: { id: true, name: true, portraitUrl: true, mainPosition: true, club: { select: { name: true, competition: { select: { tmCompetitionId: true } } } } },
  });
  return NextResponse.json(players.map((player) => ({
    ...player,
    role: normalizeRole(player.mainPosition),
    scope: player.club?.competition?.tmCompetitionId === "UZ1" ? "UZBEKISTAN" : "OTHER",
  })));
}
