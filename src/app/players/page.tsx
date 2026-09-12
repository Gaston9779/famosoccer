import { db } from "@/lib/db";
import { normalizeRole } from "@/lib/scoring/roles";
import { playerAge } from "@/lib/scoring/types";
import { playerScopeFromQuery, playerScopeWhere } from "@/lib/services/players";
import { PlayerTable } from "@/components/player-table";
import { PlayerScopeTabs } from "@/components/player-scope-tabs";
import { formatCompetitionShortCode } from "@/lib/competition-code";
import ImportForm from "./import-form";
import "./players.css";

export const dynamic = "force-dynamic";

type PlayerSearchParams = { search?: string; favorites?: string; scope?: string; minScore?: string; contract?: string; representation?: string };

function scopeHref(scope: "uzbekistan" | "ita" | "fra" | "other", search: string, favorites?: string) {
  const params = new URLSearchParams();
  if (scope !== "uzbekistan") params.set("scope", scope);
  if (search) params.set("search", search);
  if (favorites === "1") params.set("favorites", favorites);
  const query = params.toString();
  return query ? `/players?${query}` : "/players";
}

export default async function Players({ searchParams }: { searchParams: Promise<PlayerSearchParams> }) {
  const { search = "", favorites, scope: scopeParam, minScore = "", contract = "", representation = "" } = await searchParams;
  const scope = playerScopeFromQuery(scopeParam);
  const isUzbekistan = scope === "UZBEKISTAN";
  const isOther = scope === "OTHER";
  const isIta = scope === "ITA";
  const isFra = scope === "FRA";
  const players = await db.player.findMany({
    where: { ...playerScopeWhere(scope), ...(favorites === "1" ? { isFavorite: true } : {}) },
    select: {
      id: true, isFavorite: true, name: true, portraitUrl: true, mainPosition: true, birthDate: true, age: true,
      heightCm: true, preferredFoot: true,
      nationalities: true, contractExpires: true, representationStatus: true, agencyName: true, marketValueEur: true,
      club: { select: { id: true, name: true, tmClubId: true, competition: { select: { tmCompetitionId: true, name: true, country: true } } } },
      performances: { select: { minutesPlayedPercent: true } },
      opportunityHistory: { where: { isCurrent: true }, take: 1, select: { total: true, confidence: true } },
    },
    orderBy: { name: "asc" },
  });

  return <div className="players-page">
    <header className="players-page-header">
      <p className="eyebrow">Players</p>
      <h1>{isIta ? "Italian abroad" : isFra ? "France" : isOther ? "Other players" : "All players"}</h1>
      <p>{isIta ? `Explore ${players.length} Italian players abroad` : isFra ? `Explore ${players.length} French free agents` : isOther ? `Explore ${players.length} imported players outside Uzbekistan Super League` : `Explore ${players.length} players from Uzbekistan Super League`}</p>
    </header>
    <PlayerScopeTabs tabs={[
      { label: "Uzbekistan", href: scopeHref("uzbekistan", search, favorites), active: isUzbekistan },
      { label: "Italian abroad", href: scopeHref("ita", search, favorites), active: isIta },
      { label: "France", href: scopeHref("fra", search, favorites), active: isFra },
      { label: "Altro", href: scopeHref("other", search, favorites), active: isOther },
    ]}>
      <ImportForm />
      <PlayerTable key={`${search}-${favorites}-${scope}`} initialSearch={search} initialFavorites={favorites === "1"} initialMinScore={minScore} initialContract={contract} initialRepresentation={representation} rows={players.map((player) => ({
        id: player.id,
        isFavorite: player.isFavorite,
        name: player.name,
        portraitUrl: player.portraitUrl,
        club: player.club ? { id: player.club.id, name: player.club.name, tmClubId: player.club.tmClubId, competitionCode: formatCompetitionShortCode(player.club.competition) } : null,
        clubCountry: player.club?.competition?.country ?? null,
        role: normalizeRole(player.mainPosition),
        age: playerAge(player, new Date()),
        height: player.heightCm,
        foot: player.preferredFoot,
        nationality: player.nationalities === "[]" ? null : player.nationalities.replace(/[\[\]"]/g, ""),
        contract: player.contractExpires?.toISOString().slice(0, 10) ?? null,
        representation: player.representationStatus,
        agency: player.agencyName,
        marketValue: player.marketValueEur,
        playingTime: player.performances[0]?.minutesPlayedPercent ?? null,
        opportunity: player.opportunityHistory[0]?.total ?? null,
        confidence: player.opportunityHistory[0]?.confidence ?? null,
      }))} />
    </PlayerScopeTabs>
  </div>;
}
