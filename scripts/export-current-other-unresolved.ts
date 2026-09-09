import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/lib/db";

const SOURCE_PATH = "/Users/nicolaviola/Downloads/uzbekistan-super-league-2026-seed-importable-v1.json";
const OUTPUT_PATH = join(
  process.cwd(),
  "data",
  "reports",
  "current-other-unresolved-for-web-research.csv",
);

type SourcePlayer = {
  seedKey: string;
  name: string;
  clubName: string;
  season: number;
  sourcePositionGroup: string;
  mainRole: string;
  exactRoleVerified: boolean;
  tmUrl: string | null;
};

const hasText = (value: string | null | undefined) => Boolean(value?.trim());
const canonicalTextMissing = (value: string | null | undefined) =>
  !hasText(value) || value!.trim().toUpperCase() === "UNKNOWN";
const numericTmPlayerId = (value: string | null | undefined) =>
  Boolean(value?.trim() && /^\d+$/.test(value.trim()));
const transfermarktProfileUrl = (value: string | null | undefined) =>
  Boolean(
    value?.trim() &&
      /^https?:\/\/(?:www\.)?transfermarkt\.[^/]+\/.+\/profil\/spieler\/\d+(?:[/?#].*)?$/i.test(
        value.trim(),
      ),
  );
const validCanonicalIdentity = (player: { tmPlayerId: string; tmUrl: string }) =>
  numericTmPlayerId(player.tmPlayerId) && transfermarktProfileUrl(player.tmUrl);
const csv = (value: unknown) => {
  const text =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value == null
        ? ""
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

async function main() {
  const source = JSON.parse(await readFile(SOURCE_PATH, "utf8")) as {
    players: SourcePlayer[];
  };
  const sourceByKey = new Map(source.players.map((player) => [player.seedKey, player]));
  const players = await db.player.findMany({
    include: {
      club: { include: { competition: true } },
    },
    orderBy: { name: "asc" },
  });

  const other = players.filter(
    (player) => player.club?.competition?.tmCompetitionId !== "UZ1",
  );
  const unresolved = other.filter((player) => !validCanonicalIdentity(player));
  const exported = unresolved.filter((player) => {
    const currentClubUnavailable = player.clubId === null || player.careerStatus !== "ACTIVE";
    return (
      currentClubUnavailable ||
      player.careerStatus === "UNKNOWN" ||
      player.careerStatus === "FREE_AGENT" ||
      !hasText(player.portraitUrl) ||
      player.birthDate === null ||
      player.preferredFoot === "UNKNOWN" ||
      canonicalTextMissing(player.mainPosition) ||
      player.marketValueEur === null ||
      player.contractExpires === null ||
      player.representationStatus === "UNKNOWN"
    );
  });

  const headers = [
    "playerId",
    "currentName",
    "tmPlayerId",
    "tmUrl",
    "careerStatus",
    "confirmedFreeAgent",
    "currentClub",
    "currentClubTmId",
    "currentCompetition",
    "currentCompetitionTmId",
    "mainPosition",
    "positionGroup",
    "birthDate",
    "age",
    "nationalities",
    "marketValueEur",
    "contractExpires",
    "portraitPresent",
    "preferredFoot",
    "representationStatus",
    "seedKey",
    "sourceName",
    "sourceClub",
    "sourcePosition",
    "sourceSeason",
    "sourceUrl",
  ];
  const rows = exported.map((player) => {
    const seedKey = player.tmPlayerId.startsWith("seed:UZ1-2026-")
      ? player.tmPlayerId.slice("seed:".length)
      : null;
    const seed = seedKey ? sourceByKey.get(seedKey) : undefined;
    const sourcePosition = seed
      ? seed.exactRoleVerified && seed.mainRole !== "UNKNOWN"
        ? seed.mainRole
        : seed.sourcePositionGroup
      : null;
    return [
      player.id,
      player.name,
      player.tmPlayerId,
      player.tmUrl,
      player.careerStatus,
      player.confirmedFreeAgent,
      player.club?.name,
      player.club?.tmClubId,
      player.club?.competition?.name,
      player.club?.competition?.tmCompetitionId,
      player.mainPosition,
      player.positionGroup,
      player.birthDate,
      player.age,
      player.nationalities,
      player.marketValueEur,
      player.contractExpires,
      hasText(player.portraitUrl),
      player.preferredFoot,
      player.representationStatus,
      seedKey,
      seed?.name,
      seed?.clubName,
      sourcePosition,
      seed?.season,
      seed?.tmUrl,
    ]
      .map(csv)
      .join(",");
  });

  await mkdir(join(process.cwd(), "data", "reports"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${headers.join(",")}\n${rows.join("\n")}\n`, "utf8");

  const count = (predicate: (player: (typeof exported)[number]) => boolean) =>
    exported.filter(predicate).length;
  console.log(`CURRENT OTHER TOTAL: ${other.length}`);
  console.log(`OTHER WITH VALID TM ID: ${other.filter((player) => numericTmPlayerId(player.tmPlayerId)).length}`);
  console.log(`OTHER WITHOUT VALID TM ID: ${other.filter((player) => !numericTmPlayerId(player.tmPlayerId)).length}`);
  console.log(`EXPORTED FOR WEB RESEARCH: ${exported.length}`);
  console.log(`NO CURRENT CLUB: ${count((player) => player.clubId === null || player.careerStatus !== "ACTIVE")}`);
  console.log(`UNKNOWN STATUS: ${count((player) => player.careerStatus === "UNKNOWN")}`);
  console.log(`FREE_AGENT: ${count((player) => player.careerStatus === "FREE_AGENT")}`);
  console.log(`MISSING PORTRAIT: ${count((player) => !hasText(player.portraitUrl))}`);
  console.log(`MISSING DOB: ${count((player) => player.birthDate === null)}`);
  console.log(`MISSING POSITION: ${count((player) => canonicalTextMissing(player.mainPosition))}`);
  console.log(`MISSING MARKET VALUE: ${count((player) => player.marketValueEur === null)}`);
  console.log(`MISSING CONTRACT: ${count((player) => player.contractExpires === null)}`);
  console.log(`MISSING FOOT: ${count((player) => player.preferredFoot === "UNKNOWN")}`);
  console.log("EXPORTED PLAYER NAMES:");
  for (const player of exported) console.log(player.name);
  console.log(`CSV: ${OUTPUT_PATH}`);
  console.log("ZERO DB WRITES: YES");
  console.log("ZERO TRANSFERMARKT REQUESTS: YES");
}

try {
  await main();
} finally {
  await db.$disconnect();
}
