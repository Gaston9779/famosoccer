import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { db } from "../src/lib/db";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";

const dir = "src/data/import/italy-clubs";
const competition = (process.argv.find((arg) => arg.startsWith("--competition="))?.split("=")[1] ?? "IT3A").toUpperCase();
if (competition !== "IT3A" && competition !== "IT3B") throw new Error("--competition must be IT3A or IT3B");
const girone = competition === "IT3A" ? "a" : "b";
const input = `${dir}/italy_serie_c_girone_${girone}_squads_2026_27_raw.json`;
const output = `${dir}/italy_serie_c_girone_${girone}_players_2026_27_enriched.json`;
const checkpointPath = `${dir}/checkpoints/${competition.toLowerCase()}_2026_27_enrichment_checkpoint.json`;
const unresolvedPath = `${dir}/${competition.toLowerCase()}_2026_27_enrichment_unresolved.json`;
const maxArg = process.argv.find((arg) => arg.startsWith("--max-requests="));
const maxRequests = Number(maxArg?.split("=")[1] ?? 1200);
if (!Number.isSafeInteger(maxRequests) || maxRequests < 1200) throw new Error("--max-requests must be at least 1200");

type Status = "PENDING" | "SUCCESS" | "FAILED";
type Player = Record<string, any> & { tmPlayerId: string; tmUrl: string; name: string; profile: Record<string, any>; performances: any[]; profileStatus: Status; performanceStatus: Status; enrichmentStatus: Status };
type Dataset = { metadata: Record<string, any>; clubs: Array<Record<string, any> & { players: Player[] }> };
type Checkpoint = { startedAt: string; updatedAt?: string; runId?: string; stoppedReason?: string; players: Record<string, { profileStatus: Status; performanceStatus: Status; profileError?: string; performanceError?: string }> };

const present = (value: unknown) => value !== null && value !== undefined && value !== "" && value !== "UNKNOWN" && value !== "[]";
const statuses = (checkpoint: Checkpoint, id: string) => checkpoint.players[id] ?? (checkpoint.players[id] = { profileStatus: "PENDING", performanceStatus: "PENDING" });
const baseProfile = (player: any) => ({
  tmPlayerId: player.tmPlayerId, tmUrl: player.tmUrl, name: player.name,
  dateOfBirth: player.dateOfBirth ?? null, age: player.age ?? null, height: player.height ?? null,
  preferredFoot: player.preferredFoot ?? null, rawPosition: player.mainPosition ?? null,
  mainPosition: player.mainPosition ?? null, secondaryPositions: player.secondaryPositions ?? [],
  nationalities: player.nationalities ?? [], portraitUrl: player.portraitUrl ?? null,
  marketValueRaw: player.marketValueRaw ?? null, marketValueEur: player.marketValueEur ?? null,
  contractExpires: player.contractExpires ?? null, joinedDate: player.joinedDate ?? null,
  agentRaw: player.agentRaw ?? null, agencyName: player.agencyName ?? null,
  representationStatus: player.representationStatus ?? "UNKNOWN",
});

function initial(): Dataset {
  const raw = JSON.parse(readFileSync(input, "utf8"));
  const clubs = raw.clubs.map((club: any) => ({
    tmClubId: club.tmClubId, clubName: club.name, tmClubUrl: club.tmClubUrl,
    competitionKey: competition,
    players: club.squad.map((player: any) => ({
      tmPlayerId: String(player.tmPlayerId), tmUrl: player.tmUrl, name: player.name,
      profile: baseProfile(player), performances: [],
      profileStatus: "PENDING", performanceStatus: "PENDING", enrichmentStatus: "PENDING",
    })),
  }));
  return { metadata: { season: "2026/27", competitionKey: competition, clubCount: clubs.length, playerCount: clubs.reduce((n: number, c: any) => n + c.players.length, 0), createdAt: new Date().toISOString() }, clubs };
}

function mergeProfile(player: Player, parsed: Record<string, any>) {
  const profile = player.profile;
  const assign = (key: string, value: unknown) => { if (present(value)) profile[key] = value; };
  assign("tmUrl", parsed.tmUrl); assign("name", parsed.name); assign("portraitUrl", parsed.portraitUrl);
  assign("dateOfBirth", parsed.birthDate); assign("age", parsed.age); assign("height", parsed.heightCm);
  assign("preferredFoot", parsed.preferredFoot); assign("mainPosition", parsed.mainPosition);
  assign("rawPosition", parsed.mainPosition); assign("secondaryPositions", parsed.secondaryPositions);
  const nationals = typeof parsed.nationalities === "string" ? JSON.parse(parsed.nationalities) : parsed.nationalities;
  assign("nationalities", nationals); assign("marketValueRaw", parsed.marketValueRaw); assign("marketValueEur", parsed.marketValueEur);
  assign("contractExpires", parsed.contractExpires); assign("joinedDate", parsed.joinedDate);
  assign("agentRaw", parsed.agentRaw); assign("agencyName", parsed.agencyName); assign("representationStatus", parsed.representationStatus);
}

function validate(data: Dataset, checkpoint: Checkpoint) {
  const players = data.clubs.flatMap((club) => club.players);
  const ids = players.map((player) => player.tmPlayerId);
  const duplicate = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (data.clubs.length !== 20 || players.length !== data.metadata.playerCount || new Set(ids).size !== data.metadata.playerCount || duplicate.length) throw new Error(`${competition} universe invariant failed`);
  const count = (fn: (p: Player) => boolean) => players.filter(fn).length;
  const profileAttempted = count((p) => p.profileStatus !== "PENDING");
  const performanceAttempted = count((p) => p.performanceStatus !== "PENDING");
  const represented = (status: string) => count((p) => p.profile.representationStatus === status);
  const current = (p: Player) => p.performances.some((row) => row.season === "2026" && row.competitionKey === competition);
  return {
    clubs: data.clubs.length, players: players.length, uniqueTmPlayerIds: new Set(ids).size, duplicates: new Set(duplicate).size,
    PROFILE: { attempted: profileAttempted, success: count((p) => p.profileStatus === "SUCCESS"), failed: count((p) => p.profileStatus === "FAILED"), unresolved: count((p) => p.profileStatus !== "SUCCESS") },
    BIO_COVERAGE: { birthDatePresent: count((p) => present(p.profile.dateOfBirth)), heightPresent: count((p) => present(p.profile.height)), preferredFootPresent: count((p) => present(p.profile.preferredFoot)), detailedPositionPresent: count((p) => present(p.profile.mainPosition)), secondaryPositionsPresent: count((p) => present(p.profile.secondaryPositions)), nationalityPresent: count((p) => Array.isArray(p.profile.nationalities) && p.profile.nationalities.length > 0), portraitPresent: count((p) => present(p.profile.portraitUrl)), marketValuePresent: count((p) => present(p.profile.marketValueRaw)), contractExpiryPresent: count((p) => present(p.profile.contractExpires)) },
    REPRESENTATION: { REPRESENTED: represented("AGENCY"), FAMILY: represented("FAMILY"), UNREPRESENTED: represented("NO_AGENT"), NOT_LISTED: represented("NOT_LISTED"), UNKNOWN: represented("UNKNOWN") },
    SPORTING: { attempted: performanceAttempted, success: count((p) => p.performanceStatus === "SUCCESS"), failed: count((p) => p.performanceStatus === "FAILED"), playersWithPerformance: count((p) => p.performances.length > 0), playersWithCurrentCompetition: count(current), playersWithHistoricalOrOtherOnly: count((p) => p.performances.length > 0 && !current(p)), playersWithNoPerformance: count((p) => p.performances.length === 0) },
    HTTP: { totalRequests: null, HTTP200: null, HTTP403: null, HTTP404: null, HTTP429: null, HTTP503: null }, checkpoint,
  };
}

async function main() {
  await mkdir(`${dir}/checkpoints`, { recursive: true });
  const data: Dataset = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : initial();
  const checkpoint: Checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) : { startedAt: new Date().toISOString(), players: {} };
  const run = await db.syncRun.create({ data: { type: `${competition}_2026_27_PLAYER_ENRICHMENT`, metadata: JSON.stringify({ input, maxRequests }) } });
  checkpoint.runId = run.id;
  const provider = new TransfermarktProvider(new TransfermarktClient(run.id, maxRequests));
  const save = () => { checkpoint.updatedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(data, null, 2)); writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2)); };
  const totalPlayers = data.clubs.flatMap((club) => club.players).length;
  console.log(JSON.stringify({ competition, effectiveRequestBudget: maxRequests, expectedMaximum: totalPlayers * 2, players: totalPlayers, resumed: existsSync(output) }, null, 2));
  let stopped: string | null = null;
  for (const [index, player] of data.clubs.flatMap((club) => club.players).entries()) {
    const state = statuses(checkpoint, player.tmPlayerId);
    player.profileStatus = state.profileStatus; player.performanceStatus = state.performanceStatus;
    console.log(`[${index + 1}/${totalPlayers}] ${player.name} (${player.tmPlayerId})`);
    try {
      if (state.profileStatus !== "SUCCESS") { mergeProfile(player, await provider.fetchPlayerProfile(player.tmPlayerId, player.tmUrl)); state.profileStatus = player.profileStatus = "SUCCESS"; delete state.profileError; }
    } catch (error: any) { state.profileStatus = player.profileStatus = "FAILED"; state.profileError = String(error?.message ?? error); if (error?.code === "BLOCKED" || error?.code === "CIRCUIT_OPEN" || error?.code === "BUDGET") stopped = state.profileError; }
    try {
      if (!stopped && state.performanceStatus !== "SUCCESS") { player.performances = await provider.performance(player.tmPlayerId); state.performanceStatus = player.performanceStatus = "SUCCESS"; delete state.performanceError; }
    } catch (error: any) { state.performanceStatus = player.performanceStatus = "FAILED"; state.performanceError = String(error?.message ?? error); if (error?.code === "BLOCKED" || error?.code === "CIRCUIT_OPEN" || error?.code === "BUDGET") stopped = state.performanceError; }
    player.enrichmentStatus = player.profileStatus === "SUCCESS" && player.performanceStatus === "SUCCESS" ? "SUCCESS" : "FAILED";
    save(); if (stopped) break;
  }
  checkpoint.stoppedReason = stopped ?? undefined;
  const unresolved = data.clubs.flatMap((club) => club.players.filter((player) => player.profileStatus === "FAILED" || player.performanceStatus === "FAILED" || player.profile.representationStatus === "UNKNOWN" || !player.performances.some((row) => row.season === "2026" && row.competitionKey === competition)).map((player) => ({ club: club.clubName, tmPlayerId: player.tmPlayerId, name: player.name, profileStatus: player.profileStatus, performanceStatus: player.performanceStatus, representationStatus: player.profile.representationStatus, hasCurrentCompetition: player.performances.some((row) => row.season === "2026" && row.competitionKey === competition) })));
  writeFileSync(unresolvedPath, JSON.stringify(unresolved, null, 2)); save();
  const runStats = await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
  await db.syncRun.update({ where: { id: run.id }, data: { status: stopped ? "BLOCKED" : "SUCCESS", finishedAt: new Date(), message: stopped ?? null } });
  const summary = validate(data, checkpoint) as any;
  summary.HTTP = { totalRequests: runStats.requestsAttempted, HTTP200: runStats.requestsSucceeded, HTTP403: runStats.http403Count, HTTP404: 0, HTTP429: runStats.http429Count, HTTP503: runStats.http503Count };
  console.log(JSON.stringify(summary, null, 2));
  await db.$disconnect();
}
main().catch(async (error) => { console.error(error); await db.$disconnect(); process.exit(1); });
