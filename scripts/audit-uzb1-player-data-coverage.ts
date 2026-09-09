import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { playerScopeWhere } from "../src/lib/services/players";

const OUTPUT = join(process.cwd(), "data", "reports", "uzb1-player-data-coverage.csv");
const COVERAGE_FIELDS = ["ROLE", "FOOT", "PHOTO", "SPORTING", "CONTRACT", "TEAM"] as const;
type CoverageField = (typeof COVERAGE_FIELDS)[number];

const hasText = (value: string | null | undefined) => Boolean(value?.trim());
const hasUsefulText = (value: string | null | undefined) => {
  const normalized = value?.trim().toUpperCase();
  return Boolean(normalized && normalized !== "UNKNOWN" && normalized !== "[]");
};
const validDate = (value: Date | null | undefined) =>
  value instanceof Date && !Number.isNaN(value.getTime());
const validTmIdentity = (tmPlayerId: string, tmUrl: string) =>
  /^\d+$/.test(tmPlayerId) &&
  /^https?:\/\/(?:www\.)?transfermarkt\.[^/]+\/.+\/profil\/spieler\/\d+(?:[/?#].*)?$/i.test(tmUrl);

function csv(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function main() {
  // This is intentionally the same authoritative active-UZ1 scope used by the app.
  const players = await db.player.findMany({
    where: playerScopeWhere("UZBEKISTAN"),
    select: {
      id: true,
      name: true,
      tmPlayerId: true,
      tmUrl: true,
      portraitUrl: true,
      mainPosition: true,
      positionGroup: true,
      secondaryPositions: true,
      preferredFoot: true,
      contractExpires: true,
      contractOption: true,
      birthDate: true,
      age: true,
      profileLastSyncedAt: true,
      preferredFootSyncedAt: true,
      performanceLastSyncedAt: true,
      clubId: true,
      club: { select: { name: true, tmClubId: true, competition: { select: { name: true, tmCompetitionId: true } } } },
      performances: { select: { id: true, season: true, competitionCode: true } },
    },
    orderBy: { name: "asc" },
  });

  const rows = players.map((player) => {
    const current2026Uz1PerformancePresent = player.performances.some(
      (performance) => performance.season === "2026" && performance.competitionCode === "UZ1",
    );
    const present: Record<CoverageField, boolean> = {
      ROLE: hasUsefulText(player.mainPosition),
      FOOT: player.preferredFoot === "LEFT" || player.preferredFoot === "RIGHT",
      PHOTO: hasText(player.portraitUrl),
      SPORTING: current2026Uz1PerformancePresent,
      CONTRACT: validDate(player.contractExpires),
      TEAM: player.clubId !== null && player.club !== null,
    };
    const missingFields = COVERAGE_FIELDS.filter((field) => !present[field]);
    const coverageCount = COVERAGE_FIELDS.length - missingFields.length;
    const profileEverSynced = player.profileLastSyncedAt !== null;
    const coverageBucket = !profileEverSynced && coverageCount <= 3 ? "A" : coverageCount <= 3 ? "B" : coverageCount <= 5 ? "C" : "D";
    return { player, current2026Uz1PerformancePresent, present, missingFields, coverageCount, profileEverSynced, coverageBucket };
  });

  const headers = [
    "playerId", "name", "tmPlayerId", "tmUrl", "hasValidTmIdentity",
    "clubName", "tmClubId", "competitionName", "competitionTmId",
    "mainPosition", "positionGroup", "secondaryPositions", "rolePresent",
    "preferredFoot", "footPresent", "portraitUrl", "photoPresent",
    "performanceCount", "current2026Uz1PerformancePresent", "performanceLastSyncedAt", "sportingPresent",
    "contractExpires", "contractOption", "contractPresent", "teamPresent",
    "birthDate", "age", "agePresent", "profileLastSyncedAt", "preferredFootSyncedAt", "profileEverSynced",
    "coverageCount", "coveragePct", "missingFields", "coverageBucket",
  ];
  const csvRows = rows.map((row) => {
    const p = row.player;
    return [
      p.id, p.name, p.tmPlayerId, p.tmUrl, validTmIdentity(p.tmPlayerId, p.tmUrl),
      p.club?.name, p.club?.tmClubId, p.club?.competition?.name, p.club?.competition?.tmCompetitionId,
      p.mainPosition, p.positionGroup, p.secondaryPositions, row.present.ROLE,
      p.preferredFoot, row.present.FOOT, p.portraitUrl, row.present.PHOTO,
      p.performances.length, row.current2026Uz1PerformancePresent, p.performanceLastSyncedAt, row.present.SPORTING,
      p.contractExpires, p.contractOption, row.present.CONTRACT, row.present.TEAM,
      p.birthDate, p.age, validDate(p.birthDate) || p.age !== null, p.profileLastSyncedAt, p.preferredFootSyncedAt, row.profileEverSynced,
      row.coverageCount, ((row.coverageCount / COVERAGE_FIELDS.length) * 100).toFixed(1), row.missingFields.join("|"), row.coverageBucket,
    ].map(csv).join(",");
  });
  await mkdir(join(process.cwd(), "data", "reports"), { recursive: true });
  await writeFile(OUTPUT, `${headers.join(",")}\n${csvRows.join("\n")}\n`, "utf8");

  const count = (predicate: (row: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;
  const exactMissing = (...fields: CoverageField[]) => count((row) =>
    row.missingFields.length === fields.length && fields.every((field) => row.missingFields.includes(field)),
  );
  const coverage = Object.fromEntries(COVERAGE_FIELDS.map((field) => [field, count((row) => row.present[field])]));
  const buckets = Object.fromEntries(["A", "B", "C", "D"].map((bucket) => [bucket, count((row) => row.coverageBucket === bucket)]));
  const incomplete = rows.filter((row) => row.coverageBucket === "A").sort((a, b) =>
    a.coverageCount - b.coverageCount ||
    Number(a.profileEverSynced) - Number(b.profileEverSynced) ||
    (a.player.profileLastSyncedAt?.getTime() ?? 0) - (b.player.profileLastSyncedAt?.getTime() ?? 0) ||
    a.player.name.localeCompare(b.player.name),
  ).slice(0, 30);

  console.log(`CURRENT UZ1 ACTIVE PLAYERS: ${rows.length}`);
  console.log("\nCOVERAGE");
  for (const field of COVERAGE_FIELDS) console.log(`${field}: ${coverage[field]} / ${rows.length}`);
  console.log("\nBUCKETS", buckets);
  console.log("\nTARGETED MISSING SETS");
  console.log(`MISSING ONLY FOOT: ${exactMissing("FOOT")}`);
  console.log(`MISSING ONLY SPORTING: ${exactMissing("SPORTING")}`);
  console.log(`MISSING ONLY PHOTO: ${exactMissing("PHOTO")}`);
  console.log(`MISSING ONLY CONTRACT: ${exactMissing("CONTRACT")}`);
  console.log(`MISSING FOOT + SPORTING: ${exactMissing("FOOT", "SPORTING")}`);
  console.log(`MISSING PHOTO + FOOT: ${exactMissing("PHOTO", "FOOT")}`);
  console.log(`MISSING CONTRACT + SPORTING: ${exactMissing("CONTRACT", "SPORTING")}`);
  console.log("\nPRIORITY A — TOP 30");
  for (const row of incomplete) console.log(`${row.player.id} | ${row.player.name} | ${row.coverageCount}/6 | ${row.missingFields.join("|")}`);
  console.log(`\nCSV: ${OUTPUT}`);
  console.log("DATABASE WRITES: 0");
  console.log("TRANSFERMARKT REQUESTS: 0");
}

try {
  await main();
} finally {
  await db.$disconnect();
}
