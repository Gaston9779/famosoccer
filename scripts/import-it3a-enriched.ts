import "dotenv/config";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { normalizePosition } from "../src/lib/normalization";

const competitionKey = (process.argv.find((v) => v.startsWith("--competition="))?.slice(14) ?? "IT3A").toUpperCase();
if (competitionKey !== "IT3A" && competitionKey !== "IT3B") throw new Error("--competition must be IT3A or IT3B");
const girone = competitionKey === "IT3A" ? "a" : "b";
const input = process.argv.find((v) => v.startsWith("--input="))?.slice(8) ?? `src/data/import/italy-clubs/italy_serie_c_girone_${girone}_players_2026_27_enriched.json`;
const apply = process.argv.includes("--apply");
const dry = process.argv.includes("--dry-run");
const partial = process.argv.includes("--partial");
const skipPerformances = process.argv.includes("--skip-performances");
const replacePerformances = process.argv.includes("--replace-performances");
if (apply === dry) throw new Error("Use exactly one of --dry-run or --apply");
const good = (v: any) => v !== null && v !== undefined && v !== "" && v !== "UNKNOWN" && v !== "[]";
const date = (v: any) => good(v) && !Number.isNaN(new Date(v).valueOf()) ? new Date(v) : undefined;

async function main() {
  const data = JSON.parse(readFileSync(input, "utf8"));
  const rows = data.clubs.flatMap((club: any) => club.players.filter((player: any) => !partial || (player.profileStatus === "SUCCESS" && player.performanceStatus === "SUCCESS")).map((player: any) => ({ club, player })));
  const ids = rows.map((r: any) => String(r.player.tmPlayerId));
  if (data.clubs.length !== 20 || !rows.length || new Set(ids).size !== rows.length) throw new Error(`Invalid ${competitionKey} universe`);
  const existing = await db.player.findMany({ where: { tmPlayerId: { in: ids } }, select: { tmPlayerId: true } });
  const report = { mode: apply ? "APPLY" : "DRY_RUN", clubs: data.clubs.length, players: rows.length, uniqueTmPlayerIds: new Set(ids).size, existingPlayers: existing.length, newPlayers: rows.length - existing.length, duplicates: ids.length - new Set(ids).size };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;
  const name = competitionKey === "IT3A" ? "Serie C - Girone A" : "Serie C - Girone B";
  const competition = await db.competition.upsert({ where: { tmCompetitionId: competitionKey }, create: { tmCompetitionId: competitionKey, name, country: "Italy", season: "2026/27" }, update: { name, country: "Italy", season: "2026/27" } });
  const clubs = new Map<string, string>();
  for (const raw of data.clubs) {
    const club = await db.club.upsert({ where: { tmClubId: String(raw.tmClubId) }, create: { tmClubId: String(raw.tmClubId), name: raw.clubName, tmUrl: raw.tmClubUrl ?? null, competitionId: competition.id, lastSyncedAt: new Date() }, update: { name: raw.clubName, tmUrl: raw.tmClubUrl ?? null, competitionId: competition.id, lastSyncedAt: new Date() } });
    clubs.set(String(raw.tmClubId), club.id);
  }
  let performances = 0;
  const savedPlayers = new Map<string, string>();
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
    savedPlayers.set(String(player.tmPlayerId), saved.id);
  }
  if (!skipPerformances) {
    const performanceRows = rows.flatMap(({ player }: any) => (player.performances ?? []).map((raw: any) => {
      const currentCompetition = raw.competitionKey === competitionKey && ["26/27", "2026/27", "2026"].includes(raw.season);
      return {
        playerId: savedPlayers.get(String(player.tmPlayerId))!, season: currentCompetition ? "2026" : String(raw.season), competitionKey: raw.competitionKey,
        competitionName: raw.competitionName, competitionCode: raw.competitionCode ?? null, possibleGames: raw.possibleGames ?? null, gamesPlayed: raw.gamesPlayed ?? null,
        goals: raw.goals ?? null, assists: raw.assists ?? null, yellowCards: raw.yellowCards ?? null, secondYellowCards: raw.secondYellowCards ?? null,
        redCards: raw.redCards ?? null, startElevenPercent: raw.startElevenPercent ?? null, minutesPlayedPercent: raw.minutesPlayedPercent ?? null,
        minutesPlayed: raw.minutesPlayed ?? null, provider: "TRANSFERMARKT", providerStats: raw.providerStats ?? undefined, sourceUpdatedAt: new Date(),
      };
    }));
    if (replacePerformances) {
      const deleted = await db.playerPerformance.deleteMany({ where: { playerId: { in: [...savedPlayers.values()] } } });
      console.log(JSON.stringify({ event: "PERFORMANCE_REPLACE_START", deleted: deleted.count, inserting: performanceRows.length }));
    }
    const chunkSize = 500;
    for (let offset = 0; offset < performanceRows.length; offset += chunkSize) {
      const chunk = performanceRows.slice(offset, offset + chunkSize);
      await db.playerPerformance.createMany({ data: chunk, skipDuplicates: true });
      performances += chunk.length;
      console.log(JSON.stringify({ event: "PERFORMANCE_IMPORT_PROGRESS", inserted: performances, total: performanceRows.length }));
    }
  }
  console.log(JSON.stringify({ ...report, performances }, null, 2));
}
main().finally(() => db.$disconnect());
