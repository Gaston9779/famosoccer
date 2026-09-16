import "dotenv/config";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { normalizePosition } from "../src/lib/normalization";

const input = process.argv.find((v) => v.startsWith("--input="))?.slice(8) ?? "src/data/import/italy-clubs/italy_serie_c_girone_a_players_2026_27_enriched.json";
const apply = process.argv.includes("--apply");
const dry = process.argv.includes("--dry-run");
if (apply === dry) throw new Error("Use exactly one of --dry-run or --apply");
const good = (v: any) => v !== null && v !== undefined && v !== "" && v !== "UNKNOWN" && v !== "[]";
const date = (v: any) => good(v) && !Number.isNaN(new Date(v).valueOf()) ? new Date(v) : undefined;

async function main() {
  const data = JSON.parse(readFileSync(input, "utf8"));
  const rows = data.clubs.flatMap((club: any) => club.players.map((player: any) => ({ club, player })));
  const ids = rows.map((r: any) => String(r.player.tmPlayerId));
  if (data.clubs.length !== 20 || rows.length !== 540 || new Set(ids).size !== 540) throw new Error("Invalid IT3A universe; expected 20 clubs and 540 unique players");
  const existing = await db.player.findMany({ where: { tmPlayerId: { in: ids } }, select: { tmPlayerId: true } });
  const report = { mode: apply ? "APPLY" : "DRY_RUN", clubs: data.clubs.length, players: rows.length, uniqueTmPlayerIds: new Set(ids).size, existingPlayers: existing.length, newPlayers: rows.length - existing.length, duplicates: ids.length - new Set(ids).size };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;
  const competition = await db.competition.upsert({ where: { tmCompetitionId: "IT3A" }, create: { tmCompetitionId: "IT3A", name: "Serie C - Girone A", country: "Italy", season: "2026/27" }, update: { name: "Serie C - Girone A", country: "Italy", season: "2026/27" } });
  const clubs = new Map<string, string>();
  for (const raw of data.clubs) {
    const club = await db.club.upsert({ where: { tmClubId: String(raw.tmClubId) }, create: { tmClubId: String(raw.tmClubId), name: raw.clubName, tmUrl: raw.tmClubUrl ?? null, competitionId: competition.id, lastSyncedAt: new Date() }, update: { name: raw.clubName, tmUrl: raw.tmClubUrl ?? null, competitionId: competition.id, lastSyncedAt: new Date() } });
    clubs.set(String(raw.tmClubId), club.id);
  }
  let performances = 0;
  for (const { club, player } of rows) {
    const p = player.profile ?? {};
    const role = p.mainPosition ?? p.rawPosition ?? null;
    const profileData: any = { tmUrl: new URL(player.tmUrl, "https://www.transfermarkt.com").href, name: player.name, clubId: clubs.get(String(club.tmClubId)), careerStatus: "ACTIVE", confirmedFreeAgent: false };
    const put = (key: string, value: any) => { if (good(value)) profileData[key] = value; };
    put("portraitUrl", p.portraitUrl); put("birthDate", date(p.dateOfBirth)); put("age", p.age); put("heightCm", p.height); put("preferredFoot", p.preferredFoot);
    if (good(role)) { profileData.mainPosition = role; const group = normalizePosition(role); if (group !== "UNKNOWN") profileData.positionGroup = group; }
    put("secondaryPositions", Array.isArray(p.secondaryPositions) ? JSON.stringify(p.secondaryPositions) : p.secondaryPositions); put("nationalities", Array.isArray(p.nationalities) ? JSON.stringify(p.nationalities) : p.nationalities);
    put("marketValueRaw", p.marketValueRaw); put("marketValueEur", p.marketValueEur); put("contractExpires", date(p.contractExpires)); put("joinedDate", date(p.joinedDate)); put("agentRaw", p.agentRaw); put("agencyName", p.agencyName); put("representationStatus", p.representationStatus);
    const saved = await db.player.upsert({ where: { tmPlayerId: String(player.tmPlayerId) }, create: { tmPlayerId: String(player.tmPlayerId), ...profileData }, update: profileData });
    for (const raw of player.performances ?? []) {
      const currentIT3A = raw.competitionKey === "IT3A" && ["26/27", "2026/27", "2026"].includes(raw.season);
      const season = currentIT3A ? "2026" : String(raw.season);
      await db.playerPerformance.upsert({ where: { playerId_season_competitionKey: { playerId: saved.id, season, competitionKey: raw.competitionKey } }, create: { playerId: saved.id, season, competitionKey: raw.competitionKey, competitionName: raw.competitionName, competitionCode: raw.competitionCode ?? null, possibleGames: raw.possibleGames ?? null, gamesPlayed: raw.gamesPlayed ?? null, goals: raw.goals ?? null, assists: raw.assists ?? null, yellowCards: raw.yellowCards ?? null, secondYellowCards: raw.secondYellowCards ?? null, redCards: raw.redCards ?? null, startElevenPercent: raw.startElevenPercent ?? null, minutesPlayedPercent: raw.minutesPlayedPercent ?? null, minutesPlayed: raw.minutesPlayed ?? null, provider: "TRANSFERMARKT", providerStats: raw.providerStats ?? undefined, sourceUpdatedAt: new Date() }, update: Object.fromEntries(Object.entries({ competitionName: raw.competitionName, competitionCode: raw.competitionCode, possibleGames: raw.possibleGames, gamesPlayed: raw.gamesPlayed, goals: raw.goals, assists: raw.assists, yellowCards: raw.yellowCards, secondYellowCards: raw.secondYellowCards, redCards: raw.redCards, startElevenPercent: raw.startElevenPercent, minutesPlayedPercent: raw.minutesPlayedPercent, minutesPlayed: raw.minutesPlayed, sourceUpdatedAt: new Date() }).filter(([, v]) => v !== null && v !== undefined)) });
      performances++;
    }
  }
  console.log(JSON.stringify({ ...report, performances }, null, 2));
}
main().finally(() => db.$disconnect());
