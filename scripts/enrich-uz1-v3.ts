import "dotenv/config";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";
import type { RepresentationStatus } from "../src/generated/prisma/enums";
import { normalizeRole } from "../src/lib/scoring/roles";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { BudgetError, ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";

const rosterPath = path.resolve("data/uz1-2026-current-rosters.json");
const outputPath = path.resolve("data/uz1-2026-rosters-v3-enriched.json");

type RosterPlayer = {
  tmPlayerId: number;
  name: string;
  clubName: string;
  tmClubId: number;
  positionId: number | null;
  tmUrl: string | null;
};
type EnrichedPlayer = Omit<RosterPlayer, "positionId"> & {
  dateOfBirth: string | null;
  nationalities: string[] | null;
  rawPosition: string | null;
  mainRole: ReturnType<typeof normalizeRole>;
  secondaryPositions: string[] | null;
  height: number | null;
  foot: string | null;
  contractExpires: string | null;
  marketValueEur: number | null;
  representationStatus: RepresentationStatus;
  agencyName: string | null;
  enrichmentStatus: "PENDING" | "SUCCESS" | "FAILED";
  lastError: string | null;
};
type V3 = {
  version: "uz1-2026-rosters-v3";
  sourceRosterFile: string;
  rosterPlayerCount: number;
  generatedAt: string;
  updatedAt: string;
  players: EnrichedPlayer[];
};

function isRosterPlayer(value: unknown): value is RosterPlayer {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return typeof p.tmPlayerId === "number" && typeof p.name === "string" &&
    typeof p.clubName === "string" && typeof p.tmClubId === "number" &&
    (typeof p.tmUrl === "string" || p.tmUrl === null);
}
function date(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
function stringArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const strings = Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
    return strings.length ? strings : null;
  } catch {
    return null;
  }
}
function blank(player: RosterPlayer): EnrichedPlayer {
  return {
    tmPlayerId: player.tmPlayerId, tmUrl: player.tmUrl, name: player.name,
    clubName: player.clubName, tmClubId: player.tmClubId,
    dateOfBirth: null, nationalities: null, rawPosition: null,
    mainRole: "UNKNOWN", secondaryPositions: null, height: null, foot: null,
    contractExpires: null, marketValueEur: null, representationStatus: "UNKNOWN",
    agencyName: null, enrichmentStatus: "PENDING", lastError: null,
  };
}
async function save(document: V3) {
  document.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`);
  await rename(temporary, outputPath);
}
function stopFor(error: unknown) {
  return error instanceof BudgetError ||
    (error instanceof ProviderError && ["BLOCKED", "CIRCUIT_OPEN", "STOPPED", "NETWORK"].includes(error.code));
}

const rosterJson: unknown = JSON.parse(await readFile(rosterPath, "utf8"));
const clubs = rosterJson && typeof rosterJson === "object"
  ? (rosterJson as { clubs?: unknown }).clubs : undefined;
if (!Array.isArray(clubs) || clubs.length !== 16) throw new Error("Roster source must contain exactly 16 clubs.");
const roster = clubs.flatMap((club) => {
  const players = club && typeof club === "object" ? (club as { players?: unknown }).players : undefined;
  if (!Array.isArray(players) || !players.every(isRosterPlayer)) throw new Error("Roster source contains an invalid player row.");
  return players;
});
const rosterIds = new Set(roster.map((player) => player.tmPlayerId));
if (roster.length !== 409 || rosterIds.size !== 409) throw new Error("Roster source must contain exactly 409 unique tmPlayerIds.");

let document: V3 = {
  version: "uz1-2026-rosters-v3", sourceRosterFile: "data/uz1-2026-current-rosters.json",
  rosterPlayerCount: 409, generatedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  players: roster.map(blank),
};
try {
  const existing: unknown = JSON.parse(await readFile(outputPath, "utf8"));
  if (existing && typeof existing === "object" && Array.isArray((existing as V3).players)) {
    const prior = new Map((existing as V3).players.map((player) => [player.tmPlayerId, player]));
    document = {
      ...document,
      generatedAt: typeof (existing as V3).generatedAt === "string" ? (existing as V3).generatedAt : document.generatedAt,
      players: roster.map((player) => {
        const saved = prior.get(player.tmPlayerId);
        return saved?.enrichmentStatus === "SUCCESS" ? { ...saved, clubName: player.clubName, tmClubId: player.tmClubId } : blank(player);
      }),
    };
  }
} catch (error: unknown) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
await save(document);

const run = await db.syncRun.create({ data: { type: "ROSTER_V3_ENRICHMENT", status: "RUNNING" } });
const maxRequests = Number.parseInt(process.env.TM_DAILY_MAX_REQUESTS ?? "100", 10);
const provider = new TransfermarktProvider(new TransfermarktClient(run.id, Number.isFinite(maxRequests) ? maxRequests : 500));
let attempted = 0;
let halted: unknown = null;

for (const player of document.players) {
  if (player.enrichmentStatus === "SUCCESS") continue;
  attempted++;
  try {
    const profile = await provider.fetchPlayerProfile(String(player.tmPlayerId), player.tmUrl);
    player.tmUrl = profile.tmUrl ?? player.tmUrl;
    player.name = profile.name || player.name;
    player.dateOfBirth = date(profile.birthDate);
    player.nationalities = stringArray(profile.nationalities);
    player.rawPosition = profile.mainPosition ?? null;
    player.mainRole = normalizeRole(profile.mainPosition);
    player.secondaryPositions = stringArray(profile.secondaryPositions);
    player.height = profile.heightCm;
    player.foot = profile.preferredFoot;
    player.contractExpires = date(profile.contractExpires);
    player.marketValueEur = profile.marketValueEur;
    player.representationStatus = profile.representationStatus;
    player.agencyName = profile.agencyName;
    player.enrichmentStatus = "SUCCESS";
    player.lastError = null;
    await save(document);
  } catch (error) {
    if (stopFor(error)) { halted = error; break; }
    player.enrichmentStatus = "FAILED";
    player.lastError = error instanceof Error ? error.message : String(error);
    await save(document);
  }
}

const complete = document.players.every((player) => player.enrichmentStatus === "SUCCESS");
const failed = document.players.filter((player) => player.enrichmentStatus === "FAILED").length;
const current = await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
if (current.status === "RUNNING") {
  await db.syncRun.update({ where: { id: run.id }, data: {
    status: complete ? "SUCCESS" : "PARTIAL", finishedAt: new Date(),
    message: halted ? (halted instanceof Error ? halted.message : String(halted)) : failed ? `${failed} profile enrichments failed.` : null,
    metadata: JSON.stringify({ attempted, successful: document.players.filter((p) => p.enrichmentStatus === "SUCCESS").length, failed }),
  }});
}
const finalRun = await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
const count = (predicate: (player: EnrichedPlayer) => boolean) => document.players.filter(predicate).length;
console.log(JSON.stringify({
  rosterPlayers: `${document.players.length}/409`, attempted,
  successfullyEnriched: count((p) => p.enrichmentStatus === "SUCCESS"), failed,
  exactRoleCoverage: count((p) => p.mainRole !== "UNKNOWN"), dateOfBirthCoverage: count((p) => p.dateOfBirth !== null),
  nationalityCoverage: count((p) => p.nationalities !== null), contractCoverage: count((p) => p.contractExpires !== null),
  marketValueCoverage: count((p) => p.marketValueEur !== null), representationKnownCoverage: count((p) => p.representationStatus !== "UNKNOWN"),
  agencyNameCoverage: count((p) => p.agencyName !== null),
  nullOrUnknown: {
    tmUrl: count((p) => p.tmUrl === null), dateOfBirth: count((p) => p.dateOfBirth === null), nationalities: count((p) => p.nationalities === null),
    rawPosition: count((p) => p.rawPosition === null), mainRoleUnknown: count((p) => p.mainRole === "UNKNOWN"), secondaryPositions: count((p) => p.secondaryPositions === null),
    height: count((p) => p.height === null), foot: count((p) => p.foot === null), contractExpires: count((p) => p.contractExpires === null),
    marketValueEur: count((p) => p.marketValueEur === null), representationStatusUnknown: count((p) => p.representationStatus === "UNKNOWN"), agencyName: count((p) => p.agencyName === null),
  },
  httpRequestsUsed: finalRun.requestsAttempted,
  exactly409UniqueTmPlayerIds: document.players.length === 409 && new Set(document.players.map((p) => p.tmPlayerId)).size === 409,
  runStatus: finalRun.status,
}));
await db.$disconnect();
