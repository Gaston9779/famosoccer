import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/lib/db";

const SEED_PREFIX = "seed:UZ1-2026-";
const TOTAL_EXPECTED = 157;
const CSV_PATH = join(process.cwd(), "data", "reports", "remaining-uz1-seeds-audit.csv");

const hasText = (value: string | null | undefined) => Boolean(value?.trim());
const hasUsefulText = (value: string | null | undefined) => {
  const normalized = value?.trim().toUpperCase();
  return Boolean(normalized && normalized !== "UNKNOWN" && normalized !== "[]");
};

function hasNationalities(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw || raw === "[]") return false;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.some((item) => typeof item === "string" && item.trim());
  } catch {
    // Legacy non-JSON values remain usable only when they contain actual text.
    return true;
  }
}

function csv(value: unknown) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

type Quality = "STRONG" | "GOOD" | "PARTIAL" | "WEAK" | "NONE";
const qualityOrder: Record<Quality, number> = { STRONG: 0, GOOD: 1, PARTIAL: 2, WEAK: 3, NONE: 4 };

async function main() {
  const seeds = await db.player.findMany({
    where: { tmPlayerId: { startsWith: SEED_PREFIX } },
    select: {
      id: true,
      name: true,
      tmPlayerId: true,
      tmUrl: true,
      birthDate: true,
      age: true,
      nationalities: true,
      mainPosition: true,
      positionGroup: true,
      portraitUrl: true,
      marketValueEur: true,
      contractExpires: true,
      preferredFoot: true,
      profileLastSyncedAt: true,
      club: {
        select: {
          name: true,
          tmClubId: true,
          competition: { select: { tmCompetitionId: true, name: true } },
        },
      },
      performances: { select: { id: true } },
      opportunityHistory: { where: { isCurrent: true }, select: { id: true } },
    },
  });

  if (seeds.length !== TOTAL_EXPECTED)
    throw new Error(`Expected ${TOTAL_EXPECTED} remaining UZ1 seeds; database returned ${seeds.length}.`);

  const rows = seeds.map((player) => {
    const birthDate = player.birthDate !== null;
    const club = player.club !== null;
    const clubTmId = hasText(player.club?.tmClubId);
    const nationality = hasNationalities(player.nationalities);
    const mainPosition = hasUsefulText(player.mainPosition);
    const positionGroup = hasUsefulText(player.positionGroup);
    const position = mainPosition || positionGroup;
    const identitySignals = Number(birthDate) + Number(club && clubTmId) + Number(position) + Number(nationality);
    const identityQuality: Quality = identitySignals === 4 ? "STRONG" : identitySignals === 3 ? "GOOD" : identitySignals === 2 ? "PARTIAL" : identitySignals === 1 ? "WEAK" : "NONE";
    return {
      player,
      birthDate,
      club,
      clubTmId,
      nationality,
      mainPosition,
      positionGroup,
      position,
      identitySignals,
      identityQuality,
      portrait: hasText(player.portraitUrl),
      marketValue: player.marketValueEur !== null,
      contract: player.contractExpires !== null,
      foot: player.preferredFoot !== "UNKNOWN",
      profileSynced: player.profileLastSyncedAt !== null,
      performance: player.performances.length > 0,
      opportunity: player.opportunityHistory.length > 0,
    };
  });

  const count = (predicate: (row: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;
  const coverage = {
    "Birth date present": count((r) => r.birthDate),
    "Age present": count((r) => r.player.age !== null),
    "Nationality present": count((r) => r.nationality),
    "Main position present": count((r) => r.mainPosition),
    "Position group present": count((r) => r.positionGroup),
    "Any position present": count((r) => r.position),
    "Club present": count((r) => r.club),
    "Club with tmClubId present": count((r) => r.clubTmId),
    "Club mapped to UZ1": count((r) => r.player.club?.competition?.tmCompetitionId === "UZ1"),
    "Club with competition null": count((r) => r.club && r.player.club?.competition === null),
    "Without club": count((r) => !r.club),
    "Portrait present": count((r) => r.portrait),
    "Market value present": count((r) => r.marketValue),
    "Contract expiry present": count((r) => r.contract),
    "Preferred foot known": count((r) => r.foot),
    "Profile last synced present": count((r) => r.profileSynced),
    "Performance present": count((r) => r.performance),
    "Current Opportunity present": count((r) => r.opportunity),
  };

  const qualities = Object.fromEntries(
    (["STRONG", "GOOD", "PARTIAL", "WEAK", "NONE"] as Quality[]).map((quality) => [quality, count((r) => r.identityQuality === quality)]),
  );
  const combinations = {
    "DOB + club": count((r) => r.birthDate && r.club && r.clubTmId),
    "DOB + position": count((r) => r.birthDate && r.position),
    "DOB + nationality": count((r) => r.birthDate && r.nationality),
    "DOB + club + position": count((r) => r.birthDate && r.club && r.clubTmId && r.position),
    "DOB + club + nationality": count((r) => r.birthDate && r.club && r.clubTmId && r.nationality),
    "DOB + position + nationality": count((r) => r.birthDate && r.position && r.nationality),
    "DOB + club + position + nationality": count((r) => r.birthDate && r.club && r.clubTmId && r.position && r.nationality),
  };

  const clubs = new Map<string, { clubName: string; tmClubId: string | null; competition: string; count: number }>();
  for (const { player } of rows) {
    const key = player.club ? player.club.tmClubId || player.club.name : "WITHOUT CLUB";
    const current = clubs.get(key) ?? {
      clubName: player.club?.name ?? "WITHOUT CLUB",
      tmClubId: player.club?.tmClubId ?? null,
      competition: player.club?.competition ? `${player.club.competition.tmCompetitionId} | ${player.club.competition.name}` : "null",
      count: 0,
    };
    current.count++;
    clubs.set(key, current);
  }

  const sorted = [...rows].sort((a, b) =>
    qualityOrder[a.identityQuality] - qualityOrder[b.identityQuality] || a.player.name.localeCompare(b.player.name),
  );
  const headers = [
    "playerId", "name", "tmPlayerId", "tmUrl", "birthDate", "age", "nationalities", "mainPosition", "positionGroup",
    "clubName", "tmClubId", "competition", "portraitPresent", "marketValue", "contractExpires", "preferredFoot",
    "profileLastSyncedAt", "performancePresent", "opportunityPresent", "identitySignals", "identityQuality",
  ];
  const csvRows = sorted.map(({ player, portrait, marketValue, contract, profileSynced, performance, opportunity, identitySignals, identityQuality }) => [
    player.id, player.name, player.tmPlayerId, player.tmUrl, player.birthDate, player.age, player.nationalities,
    player.mainPosition, player.positionGroup, player.club?.name, player.club?.tmClubId,
    player.club?.competition ? `${player.club.competition.tmCompetitionId} | ${player.club.competition.name}` : null,
    portrait, marketValue ? player.marketValueEur : null, contract ? player.contractExpires : null, player.preferredFoot,
    profileSynced ? player.profileLastSyncedAt : null, performance, opportunity, identitySignals, identityQuality,
  ].map(csv).join(","));
  await mkdir(join(process.cwd(), "data", "reports"), { recursive: true });
  await writeFile(CSV_PATH, `${headers.join(",")}\n${csvRows.join("\n")}\n`, "utf8");

  console.log(`REMAINING UZ1 SEEDS: ${seeds.length}`);
  console.log("\nFIELD COVERAGE");
  for (const [label, value] of Object.entries(coverage)) console.log(`${label}: ${value} / ${seeds.length}`);
  console.log("\nIDENTITY QUALITY", qualities);
  console.log("\nCOMBINATION COUNTS", combinations);
  console.log("\nCLUB DISTRIBUTION");
  for (const club of [...clubs.values()].sort((a, b) => b.count - a.count || a.clubName.localeCompare(b.clubName)))
    console.log(`${club.clubName} | ${club.tmClubId ?? "null"} | ${club.competition} | ${club.count}`);
  console.log(`\nDETAILED CSV: ${CSV_PATH}`);
  console.log("\nFINAL SUMMARY", {
    "TOTAL SEEDS": seeds.length,
    ...qualities,
    "DOB PRESENT": coverage["Birth date present"],
    "CLUB PRESENT": coverage["Club present"],
    "POSITION PRESENT": coverage["Any position present"],
    "NATIONALITY PRESENT": coverage["Nationality present"],
    "POTENTIALLY RECONCILABLE WITHOUT BLIND NAME MATCHING": count((r) => r.identitySignals >= 3),
    "NO EXTERNAL REQUESTS MADE": "YES",
    "DATABASE WRITES": 0,
  });
}

try {
  await main();
} finally {
  await db.$disconnect();
}
