import "dotenv/config";
import { readFile } from "node:fs/promises";
import type { Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import { nameSimilarity, normalizePersonName } from "../src/lib/identity/name-normalization";
import { hasValidTmPlayerId } from "../src/lib/services/player-enrichment";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { emptyCounts, saveProfile } from "../src/lib/services/players";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { ProviderError } from "../src/lib/transfermarkt/errors";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allSafe = args.includes("--all-safe");
const sourceHigh = args.includes("--source-high");
const approvedMappings = args.includes("--approved-mappings");
const residualCleanup = args.includes("--residual-cleanup");
const playerName = args.find((arg) => arg.startsWith("--player="))?.slice("--player=".length);
if (!dryRun && !playerName && !allSafe && !sourceHigh && !approvedMappings && !residualCleanup)
  throw new Error('Use --dry-run, --all-safe, --source-high, --approved-mappings, --residual-cleanup, or --player="Seed Player Name".');
if ([allSafe, sourceHigh, approvedMappings, residualCleanup, Boolean(playerName)].filter(Boolean).length > 1)
  throw new Error("Use only one of --all-safe, --source-high, --approved-mappings, --residual-cleanup, or --player.");

const APPROVED_MAPPING_PATH = "data/reports/current-other-89-safe-tm-mappings.csv";
const SYNTHETIC_SEED_PREFIX = "seed:UZ1-2026-";

type ApprovedMapping = {
  playerId: string;
  canonicalName: string;
  resolvedTmPlayerId: string;
  resolvedTmProfileUrl: string;
  researchStatus: string;
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += char;
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) rows.push([...row, field.replace(/\r$/, "")]);
  return rows;
}

async function loadApprovedMappings() {
  const [header, ...rows] = parseCsv(await readFile(APPROVED_MAPPING_PATH, "utf8"));
  const index = new Map(header.map((value, position) => [value, position]));
  const required = ["playerId", "canonicalName", "resolvedTmPlayerId", "resolvedTmProfileUrl", "researchStatus"];
  for (const field of required)
    if (!index.has(field)) throw new Error(`Approved mapping CSV is missing ${field}.`);
  const mappings = rows
    .filter((row) => row.some(Boolean))
    .map((row) => {
      const mapping = Object.fromEntries(header.map((field, position) => [field, row[position] ?? ""])) as ApprovedMapping;
      // Spreadsheet exports encode integer IDs as e.g. "71238.0". Normalize
      // only that lossless representation in memory; the approved CSV stays untouched.
      mapping.resolvedTmPlayerId = mapping.resolvedTmPlayerId.trim().replace(/\.0+$/, "");
      return mapping;
    })
    .filter((row) => row.researchStatus === "TM_ID_VERIFIED");
  if (mappings.length !== 89)
    throw new Error(`Expected exactly 89 TM_ID_VERIFIED mappings; found ${mappings.length}.`);
  const ids = new Set<string>();
  for (const mapping of mappings) {
    if (!/^\d+$/.test(mapping.resolvedTmPlayerId))
      throw new Error(`Approved mapping ${mapping.playerId} has a non-numeric resolvedTmPlayerId.`);
    if (!/^https?:\/\/(?:www\.)?transfermarkt\.[^/]+\/.+\/profil\/spieler\/\d+(?:[/?#].*)?$/i.test(mapping.resolvedTmProfileUrl))
      throw new Error(`Approved mapping ${mapping.playerId} has an invalid Transfermarkt profile URL.`);
    if (ids.has(mapping.playerId)) throw new Error(`Approved mapping repeats player ${mapping.playerId}.`);
    ids.add(mapping.playerId);
  }
  return mappings;
}

const verifiedTargets = new Map([
  ["Abduvakhid Nematov", { canonicalName: "Abduvokhid Nematov", canonicalTmPlayerId: "527866" }],
  ["Khozimat Erkinov", { canonicalName: "Khozhimat Erkinov", canonicalTmPlayerId: "630015" }],
  ["Akramjon Komilov", { canonicalName: "Akramzhon Komilov", canonicalTmPlayerId: "288933" }],
  ["Ikboldzhon Malikdzhonov", { canonicalName: "Ikboljon Malikjonov", canonicalTmPlayerId: "501829" }],
  ["Diyor Turopov", { canonicalName: "Diyorzhon Turopov", canonicalTmPlayerId: "274557" }],
  ["Yahyo Zuhriddinov", { canonicalName: "Nuriddin Nuriddinov", canonicalTmPlayerId: "1134139" }],
]);

type Player = Awaited<ReturnType<typeof loadPlayers>>[number];
type SourceRow = { seedKey: string; clubName: string; season: number; sourcePositionGroup: string; mainRole: string; exactRoleVerified: boolean; birthDate: string | null };
type Pair = {
  seed: Player;
  canonical: Player;
  similarity: number;
  birthDateMatch: boolean;
  clubMatch: boolean;
  positionMatch: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  score: number;
};

async function loadPlayers() {
  return db.player.findMany({
    select: {
      id: true, tmPlayerId: true, tmUrl: true, name: true, firstName: true, lastName: true,
      portraitUrl: true, birthDate: true, age: true, birthPlace: true, nationalities: true,
      heightCm: true, preferredFoot: true, mainPosition: true, positionGroup: true,
      secondaryPositions: true, shirtNumber: true, clubId: true, joinedDate: true,
      contractExpires: true, contractOption: true, marketValueEur: true, marketValueRaw: true,
      agentRaw: true, agencyName: true, representationStatus: true, manuallyAdded: true,
      profileLastSyncedAt: true, preferredFootSyncedAt: true, performanceLastSyncedAt: true,
      confirmedFreeAgent: true, isFavorite: true,
      club: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });
}

const isSeed = (player: Player) => /^seed:UZ1-2026-/i.test(player.tmPlayerId);
const position = (player: Player) => player.mainPosition ?? player.positionGroup;
const empty = (value: string | null | undefined) => !value?.trim() || value === "[]" || value === "UNKNOWN";
const dateEqual = (left: Date | null, right: Date | null) =>
  left !== null && right !== null && left.getTime() === right.getTime();
const newest = (left: Date | null, right: Date | null) =>
  !left ? right : !right ? left : left > right ? left : right;

function parseNationalities(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return value.trim() ? [value.trim().toLowerCase()] : [];
  }
}

const sourceClubAliases: Record<string, string> = { agmk: "fc okmk olmaliq", andijon: "fc andijon", buxoro: "fc buxoro", "dinamo samarkand": "dinamo samarqand", "mashal muborak": "mash al mubarek", "qizilqum zarafshon": "fc qizilqum", "kokand 1912": "fc kokand 1912", surkhon: "surkhon termiz" };
const canonicalSourceClub = (value: string | null | undefined) => sourceClubAliases[normalizePersonName(value)] ?? normalizePersonName(value);
const sourceRoleMacro: Record<string, string> = { GK: "GK", RB: "DF", CB: "DF", LB: "DF", DM: "MF", CM: "MF", AM: "MF", RW: "FW", LW: "FW", ST: "FW" };
function playerRole(value: string | null) {
  const text = value?.toLowerCase() ?? "";
  if (/goal/.test(text)) return "GK"; if (/right.*back/.test(text)) return "RB"; if (/(centre|center).*(back|defend)/.test(text)) return "CB"; if (/left.*back/.test(text)) return "LB"; if (/defensive/.test(text)) return "DM"; if (/central.*mid/.test(text)) return "CM"; if (/attacking/.test(text)) return "AM"; if (/right.*wing/.test(text)) return "RW"; if (/left.*wing/.test(text)) return "LW"; if (/forward|striker/.test(text)) return "ST"; return null;
}

function sourceHighPair(seed: Player, canonical: Player, source: SourceRow): Pair | null {
  if (!isSeed(seed) || !hasValidTmPlayerId(canonical.tmPlayerId)) return null;
  const similarity = nameSimilarity(seed.name, canonical.name);
  const clubMatch = canonicalSourceClub(source.clubName) === canonicalSourceClub(canonical.club?.name);
  const exactRole = source.exactRoleVerified && source.mainRole !== "UNKNOWN" ? source.mainRole : null;
  const normalizedRole = playerRole(canonical.mainPosition);
  const positionMatch = exactRole ? normalizedRole === exactRole : sourceRoleMacro[normalizedRole ?? ""] === source.sourcePositionGroup;
  const sourceDob = source.birthDate ? new Date(`${source.birthDate}T00:00:00.000Z`) : null;
  const birthDateMatch = sourceDob !== null && canonical.birthDate !== null && sourceDob.getTime() === canonical.birthDate.getTime();
  const dobConflict = sourceDob !== null && canonical.birthDate !== null && !birthDateMatch;
  if (dobConflict || !clubMatch) return null;
  const score = Math.round(similarity * 50 + 30 + (positionMatch ? 12 : 0) + (birthDateMatch ? 20 : 0));
  if (!((similarity >= 0.75 && (positionMatch || birthDateMatch)) || similarity >= 0.8)) return null;
  return { seed, canonical, similarity, birthDateMatch, clubMatch, positionMatch, score, confidence: "HIGH" };
}

async function loadSourceRows() {
  const dataset = JSON.parse(await readFile("/Users/nicolaviola/Downloads/uzbekistan-super-league-2026-seed-importable-v1.json", "utf8")) as { players: SourceRow[] };
  return new Map(dataset.players.map((row) => [row.seedKey, row]));
}

function findSourceHighPairs(players: Player[], sourceRows: Map<string, SourceRow>) {
  return players.filter(isSeed).flatMap((seed) => {
    const source = sourceRows.get(seed.tmPlayerId.slice("seed:".length));
    if (!source) return [];
    const candidates = players.filter((player) => hasValidTmPlayerId(player.tmPlayerId)).map((canonical) => sourceHighPair(seed, canonical, source)).filter((pair): pair is Pair => pair !== null).sort((a, b) => b.score - a.score || b.similarity - a.similarity);
    return candidates.length ? [candidates[0]] : [];
  }).sort((a, b) => a.seed.name.localeCompare(b.seed.name));
}

function safePair(seed: Player, canonical: Player): Pair | null {
  if (!isSeed(seed) || !hasValidTmPlayerId(canonical.tmPlayerId)) return null;
  const similarity = nameSimilarity(seed.name, canonical.name);
  const birthDateMatch = dateEqual(seed.birthDate, canonical.birthDate);
  const clubMatch = seed.clubId !== null && seed.clubId === canonical.clubId;
  const positionMatch = position(seed) !== null && position(seed) === position(canonical);
  const nationalityMatch = parseNationalities(seed.nationalities).some((value) => parseNationalities(canonical.nationalities).includes(value));
  if (similarity < 0.78 && !(birthDateMatch && (clubMatch || positionMatch || nationalityMatch))) return null;
  const score = Math.round(similarity * 45 + (birthDateMatch ? 35 : 0) + (clubMatch ? 12 : 0) + (positionMatch ? 5 : 0) + (nationalityMatch ? 3 : 0));
  if (score < 40) return null;
  return {
    seed,
    canonical,
    similarity,
    birthDateMatch,
    clubMatch,
    positionMatch,
    score,
    confidence: score >= 75 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW",
  };
}

function findPairs(players: Player[]) {
  const pairs: Pair[] = [];
  for (const seed of players.filter(isSeed)) {
    for (const canonical of players.filter((player) => hasValidTmPlayerId(player.tmPlayerId))) {
      const pair = safePair(seed, canonical);
      if (pair) pairs.push(pair);
    }
  }
  return pairs.sort((a, b) => b.score - a.score || a.seed.name.localeCompare(b.seed.name));
}

function buildPlayerMergeData(canonical: Player, seed: Player): Prisma.PlayerUpdateInput {
  const data: Prisma.PlayerUpdateInput = {
    manuallyAdded: canonical.manuallyAdded || seed.manuallyAdded,
    isFavorite: canonical.isFavorite || seed.isFavorite,
    confirmedFreeAgent: canonical.confirmedFreeAgent || (canonical.clubId === null && seed.confirmedFreeAgent),
    profileLastSyncedAt: newest(canonical.profileLastSyncedAt, seed.profileLastSyncedAt),
    preferredFootSyncedAt: newest(canonical.preferredFootSyncedAt, seed.preferredFootSyncedAt),
    performanceLastSyncedAt: newest(canonical.performanceLastSyncedAt, seed.performanceLastSyncedAt),
  };
  const fields: Array<[keyof Player, (value: never) => boolean]> = [
    ["portraitUrl", (value) => !empty(value as string | null)],
    ["firstName", (value) => !empty(value as string | null)],
    ["lastName", (value) => !empty(value as string | null)],
    ["birthPlace", (value) => !empty(value as string | null)],
    ["nationalities", (value) => !empty(value as string | null)],
    ["mainPosition", (value) => !empty(value as string | null)],
    ["positionGroup", (value) => !empty(value as string | null)],
    ["secondaryPositions", (value) => !empty(value as string | null)],
    ["shirtNumber", (value) => !empty(value as string | null)],
    ["contractOption", (value) => !empty(value as string | null)],
    ["marketValueRaw", (value) => !empty(value as string | null)],
    ["agentRaw", (value) => !empty(value as string | null)],
    ["agencyName", (value) => !empty(value as string | null)],
  ];
  for (const [field, usable] of fields)
    if (!usable(canonical[field] as never) && usable(seed[field] as never))
      Object.assign(data, { [field]: seed[field] });
  for (const field of ["birthDate", "age", "heightCm", "joinedDate", "contractExpires", "marketValueEur"] as const)
    if (canonical[field] === null && seed[field] !== null)
      Object.assign(data, { [field]: seed[field] });
  if (canonical.preferredFoot === "UNKNOWN" && seed.preferredFoot !== "UNKNOWN")
    data.preferredFoot = seed.preferredFoot;
  if (canonical.representationStatus === "UNKNOWN" && seed.representationStatus !== "UNKNOWN")
    data.representationStatus = seed.representationStatus;
  if (canonical.clubId === null && seed.clubId !== null)
    data.club = { connect: { id: seed.clubId } };
  return data;
}

type RelationSummary = {
  performances: number;
  snapshots: number;
  opportunityHistories: number;
  currentOpportunityHistories: number;
  events: number;
  notes: number;
  tags: number;
};

async function relationSummary(client: Prisma.TransactionClient | typeof db, playerId: string): Promise<RelationSummary> {
  const [performances, snapshots, opportunityHistories, currentOpportunityHistories, events, notes, tags] = await Promise.all([
    client.playerPerformance.count({ where: { playerId } }),
    client.playerSnapshot.count({ where: { playerId } }),
    client.playerOpportunityHistory.count({ where: { playerId } }),
    client.playerOpportunityHistory.count({ where: { playerId, isCurrent: true } }),
    client.playerEvent.count({ where: { playerId } }),
    client.playerNote.count({ where: { playerId } }),
    client.playerTagAssignment.count({ where: { playerId } }),
  ]);
  return { performances, snapshots, opportunityHistories, currentOpportunityHistories, events, notes, tags };
}

async function inspectPair(pair: Pair) {
  const [seedRelations, canonicalRelations, seedPerformances, canonicalPerformances, seedTags, canonicalTags] = await Promise.all([
    relationSummary(db, pair.seed.id),
    relationSummary(db, pair.canonical.id),
    db.playerPerformance.findMany({ where: { playerId: pair.seed.id } }),
    db.playerPerformance.findMany({ where: { playerId: pair.canonical.id } }),
    db.playerTagAssignment.findMany({ where: { playerId: pair.seed.id }, select: { tagId: true } }),
    db.playerTagAssignment.findMany({ where: { playerId: pair.canonical.id }, select: { tagId: true } }),
  ]);
  const canonicalPerformanceKeys = new Set(canonicalPerformances.map((row) => `${row.season}:${row.competitionKey}`));
  const performanceConflicts = seedPerformances.filter((row) => canonicalPerformanceKeys.has(`${row.season}:${row.competitionKey}`));
  const canonicalTagIds = new Set(canonicalTags.map((tag) => tag.tagId));
  const tagConflicts = seedTags.filter((tag) => canonicalTagIds.has(tag.tagId));
  return { seedRelations, canonicalRelations, performanceConflicts, tagConflicts, mergedFields: Object.keys(buildPlayerMergeData(pair.canonical, pair.seed)) };
}

function printPlan(pair: Pair, inspection: Awaited<ReturnType<typeof inspectPair>>) {
  console.log(`\nSEED: ${pair.seed.name} | ${pair.seed.id} | ${pair.seed.tmPlayerId}`);
  console.log(`CANONICAL: ${pair.canonical.name} | ${pair.canonical.id} | ${pair.canonical.tmPlayerId}`);
  console.log(`Signals: ${(pair.similarity * 100).toFixed(1)}% name, DOB=${pair.birthDateMatch}, club=${pair.clubMatch}, position=${pair.positionMatch}, ${pair.confidence} (${pair.score})`);
  console.log("Relations on seed:", inspection.seedRelations);
  console.log("Conflicts detected:", {
    performanceUniqueKey: inspection.performanceConflicts.length,
    tagCompositeKey: inspection.tagConflicts.length,
    currentOpportunityRows: inspection.seedRelations.currentOpportunityHistories && inspection.canonicalRelations.currentOpportunityHistories,
  });
  console.log("Planned canonical field fills:", inspection.mergedFields);
  console.log(`Planned result: KEEP ${pair.canonical.id}; DELETE ${pair.seed.id}`);
}

function performanceData(row: Awaited<ReturnType<typeof db.playerPerformance.findFirst>>) {
  if (!row) throw new Error("Performance row missing.");
  return {
    possibleGames: row.possibleGames,
    gamesPlayed: row.gamesPlayed,
    goals: row.goals,
    assists: row.assists,
    yellowCards: row.yellowCards,
    secondYellowCards: row.secondYellowCards,
    redCards: row.redCards,
    startElevenPercent: row.startElevenPercent,
    minutesPlayedPercent: row.minutesPlayedPercent,
    minutesPlayed: row.minutesPlayed,
    sourceUpdatedAt: row.sourceUpdatedAt,
  };
}

async function mergePair(pair: Pair, validator = (seed: Player, canonical: Player) => safePair(seed, canonical) !== null) {
  const totalBefore = await db.player.count();
  const before = await inspectPair(pair);
  await db.$transaction(async (tx) => {
    const [seed, canonical] = await Promise.all([
      tx.player.findUniqueOrThrow({ where: { id: pair.seed.id }, include: { club: { select: { name: true } } } }),
      tx.player.findUniqueOrThrow({ where: { id: pair.canonical.id }, include: { club: { select: { name: true } } } }),
    ]);
    if (!validator(seed as Player, canonical as Player))
      throw new Error("Unsafe merge: canonical/seed identity changed before transaction.");
    await tx.player.update({ where: { id: canonical.id }, data: buildPlayerMergeData(canonical as Player, seed as Player) });

    const seedPerformances = await tx.playerPerformance.findMany({ where: { playerId: seed.id } });
    for (const row of seedPerformances) {
      const where = { playerId_season_competitionKey: { playerId: canonical.id, season: row.season, competitionKey: row.competitionKey } };
      const existing = await tx.playerPerformance.findUnique({ where });
      if (!existing) await tx.playerPerformance.update({ where: { id: row.id }, data: { playerId: canonical.id } });
      else {
        const source = row.sourceUpdatedAt > existing.sourceUpdatedAt ? row : existing;
        const fallback = source === row ? existing : row;
        const data = performanceData(source);
        for (const key of Object.keys(data) as Array<keyof typeof data>)
          if (data[key] === null && fallback[key] !== null) data[key] = fallback[key] as never;
        await tx.playerPerformance.update({ where: { id: existing.id }, data });
        await tx.playerPerformance.delete({ where: { id: row.id } });
      }
    }

    const canonicalCurrent = await tx.playerOpportunityHistory.count({ where: { playerId: canonical.id, isCurrent: true } });
    if (canonicalCurrent)
      await tx.playerOpportunityHistory.updateMany({ where: { playerId: seed.id, isCurrent: true }, data: { isCurrent: false } });
    await Promise.all([
      tx.playerSnapshot.updateMany({ where: { playerId: seed.id }, data: { playerId: canonical.id } }),
      tx.playerOpportunityHistory.updateMany({ where: { playerId: seed.id }, data: { playerId: canonical.id } }),
      tx.playerEvent.updateMany({ where: { playerId: seed.id }, data: { playerId: canonical.id } }),
      tx.playerNote.updateMany({ where: { playerId: seed.id }, data: { playerId: canonical.id } }),
    ]);
    const seedTags = await tx.playerTagAssignment.findMany({ where: { playerId: seed.id } });
    for (const assignment of seedTags) {
      const existing = await tx.playerTagAssignment.findUnique({ where: { playerId_tagId: { playerId: canonical.id, tagId: assignment.tagId } } });
      if (!existing) await tx.playerTagAssignment.update({ where: { playerId_tagId: { playerId: seed.id, tagId: assignment.tagId } }, data: { playerId: canonical.id } });
      else await tx.playerTagAssignment.delete({ where: { playerId_tagId: { playerId: seed.id, tagId: assignment.tagId } } });
    }
    await tx.player.delete({ where: { id: seed.id } });
  });
  const [remainingSeed, canonical, totalAfter, sameIdentityRows] = await Promise.all([
    db.player.findUnique({ where: { id: pair.seed.id } }),
    db.player.findUniqueOrThrow({ where: { id: pair.canonical.id } }),
    db.player.count(),
    db.player.count({ where: { name: { in: [pair.seed.name, pair.canonical.name] } } }),
  ]);
  const after = await relationSummary(db, pair.canonical.id);
  if (remainingSeed || canonical.id !== pair.canonical.id || !hasValidTmPlayerId(canonical.tmPlayerId) || totalAfter !== totalBefore - 1 || sameIdentityRows !== 1)
    throw new Error("Post-merge verification failed.");
  const expected = {
    performances: before.seedRelations.performances + before.canonicalRelations.performances - before.performanceConflicts.length,
    snapshots: before.seedRelations.snapshots + before.canonicalRelations.snapshots,
    opportunityHistories: before.seedRelations.opportunityHistories + before.canonicalRelations.opportunityHistories,
    events: before.seedRelations.events + before.canonicalRelations.events,
    notes: before.seedRelations.notes + before.canonicalRelations.notes,
    tags: before.seedRelations.tags + before.canonicalRelations.tags - before.tagConflicts.length,
  };
  for (const [key, value] of Object.entries(expected) as Array<[keyof typeof expected, number]>)
    if (after[key] !== value) throw new Error(`Post-merge ${key} verification failed.`);
  console.log("BEFORE / AFTER", { playerCount: `${totalBefore} -> ${totalAfter}`, seedRelations: before.seedRelations, canonicalRelationsAfter: after, canonicalId: canonical.id, canonicalTmPlayerId: canonical.tmPlayerId });
}

async function refreshSafePair(pair: Pair) {
  const [seed, canonical] = await Promise.all([
    db.player.findUnique({ where: { id: pair.seed.id }, include: { club: { select: { name: true } } } }),
    db.player.findUnique({ where: { id: pair.canonical.id }, include: { club: { select: { name: true } } } }),
  ]);
  if (!seed || !canonical) return null;
  return safePair(seed as Player, canonical as Player);
}

async function refreshSourceHighPair(pair: Pair, sourceRows: Map<string, SourceRow>) {
  const pairs = findSourceHighPairs(await loadPlayers(), sourceRows);
  return pairs.find((candidate) => candidate.seed.id === pair.seed.id && candidate.canonical.id === pair.canonical.id) ?? null;
}

async function bulkSummary(beforeTotal: number, safePairsFound: number, merged: number, skipped: number, failed: number) {
  const players = await db.player.findMany({ select: { tmPlayerId: true } });
  const validCounts = new Map<string, number>();
  for (const player of players)
    if (hasValidTmPlayerId(player.tmPlayerId))
      validCounts.set(player.tmPlayerId, (validCounts.get(player.tmPlayerId) ?? 0) + 1);
  console.log("\nBULK RECONCILIATION SUMMARY", {
    "BEFORE TOTAL": beforeTotal,
    "SAFE PAIRS FOUND": safePairsFound,
    MERGED: merged,
    SKIPPED: skipped,
    FAILED: failed,
    "AFTER TOTAL": players.length,
    "REMAINING seed:UZ1-2026-* RECORDS": players.filter((player) => /^seed:UZ1-2026-/i.test(player.tmPlayerId)).length,
    "DUPLICATE VALID tmPlayerId": [...validCounts.values()].filter((count) => count > 1).length,
  });
}

async function resolveApprovedMappingIdentity(mapping: ApprovedMapping, players: Player[]) {
  const source = players.find((player) => player.id === mapping.playerId);
  if (!source || !source.tmPlayerId.startsWith(SYNTHETIC_SEED_PREFIX))
    return { status: "SKIPPED" as const, targetId: null, message: "source player is missing or no longer synthetic" };
  const canonical = players.find((player) => player.tmPlayerId === mapping.resolvedTmPlayerId);
  if (canonical && canonical.id !== source.id) {
    const pair: Pair = {
      seed: source,
      canonical,
      similarity: 1,
      birthDateMatch: false,
      clubMatch: false,
      positionMatch: false,
      confidence: "HIGH",
      score: 100,
    };
    await mergePair(
      pair,
      (seed, existing) =>
        seed.id === mapping.playerId &&
        seed.tmPlayerId.startsWith(SYNTHETIC_SEED_PREFIX) &&
        existing.tmPlayerId === mapping.resolvedTmPlayerId,
    );
    return { status: "MERGED" as const, targetId: canonical.id, message: null };
  }
  if (canonical?.id === source.id)
    return { status: "SKIPPED" as const, targetId: null, message: "source already has the resolved identity" };
  await db.$transaction(async (tx) => {
    const current = await tx.player.findUniqueOrThrow({ where: { id: mapping.playerId } });
    if (!current.tmPlayerId.startsWith(SYNTHETIC_SEED_PREFIX))
      throw new Error("Source player identity changed before conversion.");
    const collision = await tx.player.findUnique({ where: { tmPlayerId: mapping.resolvedTmPlayerId } });
    if (collision) throw new Error("Resolved identity appeared before conversion.");
    await tx.player.update({
      where: { id: current.id },
      data: {
        tmPlayerId: mapping.resolvedTmPlayerId,
        tmUrl: mapping.resolvedTmProfileUrl,
        name: mapping.canonicalName,
      },
    });
  });
  return { status: "CONVERTED" as const, targetId: mapping.playerId, message: null };
}

async function executeApprovedMappings() {
  await withSyncLock(async () => {
    const mappings = await loadApprovedMappings();
    let players = await loadPlayers();
    const targets: Array<{ mapping: ApprovedMapping; playerId: string }> = [];
    let merged = 0;
    let converted = 0;
    let skipped = 0;
    let failed = 0;

    for (const mapping of mappings) {
      try {
        const result = await resolveApprovedMappingIdentity(mapping, players);
        if (result.status === "MERGED") merged++;
        else if (result.status === "CONVERTED") converted++;
        else skipped++;
        if (result.targetId) targets.push({ mapping, playerId: result.targetId });
        if (result.message) console.log(`IDENTITY SKIPPED ${mapping.playerId}: ${result.message}`);
        players = await loadPlayers();
      } catch (error) {
        failed++;
        console.error(`IDENTITY FAILED ${mapping.playerId}: ${error instanceof Error ? error.message : String(error)}`);
        players = await loadPlayers();
      }
    }

    const remainingSyntheticSeeds = await db.player.count({
      where: { tmPlayerId: { startsWith: SYNTHETIC_SEED_PREFIX } },
    });
    console.log("IDENTITY RESULTS BEFORE REFRESH", {
      REQUESTED: mappings.length,
      MERGED: merged,
      CONVERTED: converted,
      SKIPPED: skipped,
      FAILED: failed,
      "REMAINING SYNTHETIC SEEDS": remainingSyntheticSeeds,
    });

    const run = await db.syncRun.create({ data: { type: "MANUAL" } });
    const counts = emptyCounts();
    const provider = new TransfermarktProvider(new TransfermarktClient(run.id, targets.length));
    let profileSuccess = 0;
    let profilePartial = 0;
    let profileFailed = 0;
    let stopped = false;
    for (const { mapping, playerId } of targets) {
      if (stopped) {
        profilePartial++;
        continue;
      }
      try {
        const saved = await saveProfile(
          await provider.fetchPlayerProfile(mapping.resolvedTmPlayerId, mapping.resolvedTmProfileUrl),
          counts,
          true,
        );
        if (saved.id !== playerId)
          throw new Error("Profile persistence did not resolve to the expected player row.");
        await calculateAndPersistPlayerOpportunity(saved.id);
        profileSuccess++;
        console.log(`PROFILE SUCCESS ${mapping.resolvedTmPlayerId} -> ${saved.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof ProviderError && error.code === "HTTP" && error.status === 404) {
          profilePartial++;
          console.error(`PROFILE PARTIAL ${mapping.resolvedTmPlayerId}: ${message}`);
        } else {
          profileFailed++;
          console.error(`PROFILE FAILED ${mapping.resolvedTmPlayerId}: ${message}`);
        }
        if (error instanceof ProviderError && ["BLOCKED", "STOPPED", "CIRCUIT_OPEN", "BUDGET_EXHAUSTED"].includes(error.code))
          stopped = true;
      }
    }
    await finishRun(
      run.id,
      profileFailed || profilePartial ? new Error("One or more approved profile refreshes were incomplete.") : undefined,
      { requested: mappings.length, merged, converted, skipped, identityFailed: failed, profileSuccess, profilePartial, profileFailed, counts },
    );
    console.log("APPROVED MAPPING SUMMARY", {
      REQUESTED: mappings.length,
      MERGED: merged,
      CONVERTED: converted,
      SKIPPED: skipped,
      "IDENTITY FAILED": failed,
      "PROFILE REFRESH SUCCESS": profileSuccess,
      "PROFILE REFRESH PARTIAL": profilePartial,
      "PROFILE REFRESH FAILED": profileFailed,
      "TM HTTP REQUESTS": profileSuccess + profilePartial + profileFailed - (stopped ? Math.max(0, targets.length - profileSuccess - profilePartial - profileFailed) : 0),
      "REMAINING SYNTHETIC SEEDS": await db.player.count({ where: { tmPlayerId: { startsWith: SYNTHETIC_SEED_PREFIX } } }),
    });
  });
}

type ResidualFact = {
  id: string;
  name: string;
  clubFragment: string;
  mainPosition: string;
  positionGroup: "DF" | "MF" | "FW";
  birthDate?: string;
};

const residualFacts: ResidualFact[] = [
  { id: "cmtr671h200d733ynwws0lxno", name: "Amirbek Berdiyev", clubFragment: "neftchi", mainPosition: "Forward", positionGroup: "FW" },
  { id: "cmtr671gy00d133ynvzwubv9m", name: "Asilbek To'xtasinov", clubFragment: "neftchi", mainPosition: "Midfielder", positionGroup: "MF", birthDate: "2007-08-22" },
  { id: "cmtr671gr00cp33yngs7q8exv", name: "Husanboy Umirzoqov", clubFragment: "neftchi", mainPosition: "Midfielder", positionGroup: "MF", birthDate: "2005-12-24" },
  { id: "cmtr671jn00jn33yn1h60rrej", name: "Jahongir Hoshimboyev", clubFragment: "loko", mainPosition: "Midfielder", positionGroup: "MF", birthDate: "2006-03-22" },
  { id: "cmtr671gh00cf33yng70ue6xm", name: "Mirjalol Abdurahimov", clubFragment: "neftchi", mainPosition: "Defender", positionGroup: "DF", birthDate: "2006-05-16" },
  // Current 2026 Xorazm evidence takes precedence over the stale historical TM status.
  { id: "cmtr671kl00mb33yny139prou", name: "Mukhammadzhon Razhabboev", clubFragment: "xorazm", mainPosition: "Forward", positionGroup: "FW" },
  { id: "cmtr671gv00ct33yn6sbcdgr6", name: "Yahyo To'xtashev", clubFragment: "neftchi", mainPosition: "Midfielder", positionGroup: "MF" },
  { id: "cmtr671h300d933ynciawl3l0", name: "Yahyo Zuhriddinov", clubFragment: "neftchi", mainPosition: "Forward", positionGroup: "FW", birthDate: "2008-08-13" },
  { id: "cmtr671gt00cr33ynjju6fciu", name: "Yahyoxon Isaqov", clubFragment: "neftchi", mainPosition: "Midfielder", positionGroup: "MF", birthDate: "2007-05-15" },
];

async function executeResidualCleanup() {
  await withSyncLock(async () => {
    let players = await loadPlayers();
    const zhasur: ApprovedMapping = {
      playerId: "cmtr671k000kp33ynsxssn6nw",
      canonicalName: "Zhasur Khasanov",
      resolvedTmPlayerId: "127745",
      resolvedTmProfileUrl: "https://www.transfermarkt.com/-/profil/spieler/127745",
      researchStatus: "TM_ID_VERIFIED",
    };
    const existingZhasur = players.find((player) => player.id === zhasur.playerId);
    const zhasurIdentity = existingZhasur?.tmPlayerId === zhasur.resolvedTmPlayerId
      ? { status: "CONVERTED" as const, targetId: existingZhasur.id, message: null }
      : await resolveApprovedMappingIdentity(zhasur, players);
    if (!zhasurIdentity.targetId)
      throw new Error(`Zhasur identity was not resolved: ${zhasurIdentity.message ?? zhasurIdentity.status}`);
    players = await loadPlayers();

    const clubs = await db.club.findMany({
      where: { competition: { tmCompetitionId: "UZ1" } },
      select: { id: true, name: true },
    });
    const clubFor = (fragment: string) => {
      const matches = clubs.filter((club) => club.name.toLowerCase().includes(fragment));
      if (matches.length !== 1) throw new Error(`Expected one UZ1 club matching ${fragment}; found ${matches.length}.`);
      return matches[0];
    };
    const zhasurFact: ResidualFact = {
      id: zhasurIdentity.targetId,
      name: "Zhasur Khasanov",
      clubFragment: "loko",
      mainPosition: "Right Midfield",
      positionGroup: "MF",
      birthDate: "1989-07-24",
    };
    const updated: string[] = [];
    for (const fact of [...residualFacts, zhasurFact]) {
      const player = await db.player.findUniqueOrThrow({ where: { id: fact.id } });
      const club = clubFor(fact.clubFragment);
      const birthDate = fact.birthDate ? new Date(`${fact.birthDate}T00:00:00.000Z`) : null;
      const alreadyCurrent =
        player.name === fact.name &&
        player.clubId === club.id &&
        player.mainPosition === fact.mainPosition &&
        player.positionGroup === fact.positionGroup &&
        player.careerStatus === "ACTIVE" &&
        !player.confirmedFreeAgent &&
        (!birthDate || player.birthDate?.getTime() === birthDate.getTime());
      if (!alreadyCurrent) {
        await db.player.update({
          where: { id: player.id },
          data: {
            name: fact.name,
            clubId: club.id,
            mainPosition: fact.mainPosition,
            positionGroup: fact.positionGroup,
            ...(birthDate ? { birthDate } : {}),
            careerStatus: "ACTIVE",
            confirmedFreeAgent: false,
          },
        });
        await calculateAndPersistPlayerOpportunity(player.id);
        updated.push(fact.name);
      }
    }

    const run = await db.syncRun.create({ data: { type: "MANUAL" } });
    const counts = emptyCounts();
    const provider = new TransfermarktProvider(new TransfermarktClient(run.id, 1));
    let jonibekResult: "success" | "403" | "failed" = "failed";
    try {
      const saved = await saveProfile(
        await provider.fetchPlayerProfile("883721", "https://www.transfermarkt.com/-/profil/spieler/883721"),
        counts,
        true,
      );
      await calculateAndPersistPlayerOpportunity(saved.id);
      jonibekResult = "success";
      await finishRun(run.id, undefined, { jonibekResult, counts });
    } catch (error) {
      jonibekResult = error instanceof ProviderError && error.status === 403 ? "403" : "failed";
      await finishRun(run.id, error, { jonibekResult, counts });
    }
    console.log("RESIDUAL CLEANUP SUMMARY", {
      ZHASUR: zhasurIdentity.status,
      "CURRENT DATA POPULATED": updated.length,
      "JONIBEK RETRY": jonibekResult,
      "HTTP REQUESTS": await db.syncRun.findUniqueOrThrow({ where: { id: run.id }, select: { requestsAttempted: true } }).then((value) => value.requestsAttempted),
      "REMAINING SYNTHETIC SEEDS": await db.player.count({ where: { tmPlayerId: { startsWith: SYNTHETIC_SEED_PREFIX } } }),
    });
  });
}

async function main() {
  if (residualCleanup) {
    await executeResidualCleanup();
    return;
  }
  if (approvedMappings) {
    await executeApprovedMappings();
    return;
  }
  const players = await loadPlayers();
  const pairs = findPairs(players);
  if (dryRun) {
    console.log(`DRY RUN: ${pairs.length} seed → canonical candidates; zero writes.`);
    for (const pair of pairs) printPlan(pair, await inspectPair(pair));
    return;
  }
  if (allSafe) {
    const beforeTotal = await db.player.count();
    let merged = 0;
    let skipped = 0;
    let failed = 0;
    const processedSeedIds = new Set<string>();
    for (const planned of pairs) {
      if (processedSeedIds.has(planned.seed.id)) {
        skipped++;
        continue;
      }
      processedSeedIds.add(planned.seed.id);
      const pair = await refreshSafePair(planned);
      if (!pair) {
        skipped++;
        console.log(`SKIPPED: ${planned.seed.name}; pair is no longer a safe A match.`);
        continue;
      }
      try {
        printPlan(pair, await inspectPair(pair));
        await mergePair(pair);
        merged++;
      } catch (error) {
        failed++;
        console.error(`FAILED: ${pair.seed.name} -> ${pair.canonical.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await bulkSummary(beforeTotal, pairs.length, merged, skipped, failed);
    return;
  }
  if (sourceHigh) {
    const sourceRows = await loadSourceRows();
    const plannedPairs = findSourceHighPairs(players, sourceRows);
    if (plannedPairs.length !== 11)
      throw new Error(`Expected exactly 11 source-correlated HIGH pairs; found ${plannedPairs.length}.`);
    const beforeTotal = await db.player.count();
    let merged = 0;
    let skipped = 0;
    let failed = 0;
    for (const planned of plannedPairs) {
      const pair = await refreshSourceHighPair(planned, sourceRows);
      if (!pair) {
        skipped++;
        console.log(`SKIPPED: ${planned.seed.name}; no longer the best source-correlated HIGH pair.`);
        continue;
      }
      try {
        printPlan(pair, await inspectPair(pair));
        const source = sourceRows.get(pair.seed.tmPlayerId.slice("seed:".length));
        await mergePair(pair, (seed, canonical) => source !== undefined && sourceHighPair(seed, canonical, source) !== null);
        merged++;
      } catch (error) {
        failed++;
        console.error(`FAILED: ${pair.seed.name} -> ${pair.canonical.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const [afterTotal, remainingSeeds, susnjarPlayers] = await Promise.all([
      db.player.count(),
      db.player.count({ where: { tmPlayerId: { startsWith: "seed:UZ1-2026-" } } }),
      db.player.findMany({ where: { name: { contains: "susnjar", mode: "insensitive" } }, select: { id: true, name: true, tmPlayerId: true } }),
    ]);
    console.log("SOURCE-HIGH MERGE SUMMARY", { "BEFORE TOTAL": beforeTotal, MERGED: merged, SKIPPED: skipped, FAILED: failed, "AFTER TOTAL": afterTotal, "REMAINING SEEDS": remainingSeeds });
    console.log("SUSNJAR VERIFICATION", { logicalPlayers: susnjarPlayers.length, players: susnjarPlayers });
    return;
  }
  const verified = verifiedTargets.get(playerName!);
  if (!verified)
    throw new Error("Real reconciliation is restricted to the two manually verified player names.");
  let pair = pairs.find((candidate) =>
    candidate.seed.name === playerName &&
    candidate.canonical.name === verified.canonicalName &&
    candidate.canonical.tmPlayerId === verified.canonicalTmPlayerId,
  );
  // Explicitly approved spelling variants may fall below the general fuzzy
  // threshold after source fields were lost. They still use the identical
  // transactional merge path, with a strict ID/name revalidation.
  if (!pair) {
    const seed = players.find((player) => player.name === playerName && isSeed(player));
    const canonical = players.find((player) => player.name === verified.canonicalName && player.tmPlayerId === verified.canonicalTmPlayerId);
    if (seed && canonical)
      pair = { seed, canonical, similarity: nameSimilarity(seed.name, canonical.name), birthDateMatch: dateEqual(seed.birthDate, canonical.birthDate), clubMatch: false, positionMatch: false, confidence: "HIGH", score: 100 };
  }
  if (!pair) throw new Error("Verified seed/canonical pair is not present; no merge was run.");
  printPlan(pair, await inspectPair(pair));
  await mergePair(pair, (seed, canonical) => isSeed(seed) && canonical.tmPlayerId === verified.canonicalTmPlayerId && canonical.name === verified.canonicalName);
}

try {
  await main();
} finally {
  await db.$disconnect();
}
