import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { nameSimilarity, normalizePersonName } from "../src/lib/identity/name-normalization";

const sourcePath = "/Users/nicolaviola/Downloads/uzbekistan-super-league-2026-seed-importable-v1.json";
const outputPath = join(process.cwd(), "data", "reports", "remaining-uz1-seed-local-identity-audit.csv");
type SourceSeed = {
  seedKey: string;
  name: string;
  clubName: string;
  season: number;
  sourcePositionGroup: string;
  mainRole: string;
  exactRoleVerified: boolean;
  birthDate: string | null;
};
const aliases: Record<string, string> = { agmk: "fc okmk olmaliq", andijon: "fc andijon", buxoro: "fc buxoro", "dinamo samarkand": "dinamo samarqand", "mashal muborak": "mash al mubarek", "qizilqum zarafshon": "fc qizilqum", "kokand 1912": "fc kokand 1912", surkhon: "surkhon termiz" };
const canonicalClub = (value: string | null | undefined) => aliases[normalizePersonName(value)] ?? normalizePersonName(value);
const roleMacro: Record<string, string> = { GK: "GK", RB: "DF", CB: "DF", LB: "DF", DM: "MF", CM: "MF", AM: "MF", RW: "FW", LW: "FW", ST: "FW" };

function playerRole(value: string | null) {
  const text = value?.toLowerCase() ?? "";
  if (/goal/.test(text)) return "GK";
  if (/right.*back/.test(text)) return "RB";
  if (/(centre|center).*(back|defend)/.test(text)) return "CB";
  if (/left.*back/.test(text)) return "LB";
  if (/defensive/.test(text)) return "DM";
  if (/central.*mid/.test(text)) return "CM";
  if (/attacking/.test(text)) return "AM";
  if (/right.*wing/.test(text)) return "RW";
  if (/left.*wing/.test(text)) return "LW";
  if (/forward|striker/.test(text)) return "ST";
  return null;
}

function csv(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

async function main() {
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as { players: SourceSeed[] };
  const byKey = new Map(source.players.map((row) => [row.seedKey, row]));
  const players = await db.player.findMany({ include: { club: true } });
  const seeds = players.filter((player) => player.tmPlayerId.startsWith("seed:UZ1-2026-"));
  const canonicals = players.filter((player) => /^\d+$/.test(player.tmPlayerId));
  const reports = seeds.map((seed) => {
    const sourceRow = byKey.get(seed.tmPlayerId.slice("seed:".length));
    if (!sourceRow) throw new Error(`Source row missing for ${seed.tmPlayerId}`);
    const sourceExactRole = sourceRow.exactRoleVerified && sourceRow.mainRole !== "UNKNOWN" ? sourceRow.mainRole : null;
    const candidates = canonicals.map((canonical) => {
      const similarity = nameSimilarity(seed.name, canonical.name);
      const exactNormalizedName = normalizePersonName(seed.name) === normalizePersonName(canonical.name);
      const clubMatch = canonicalClub(sourceRow.clubName) === canonicalClub(canonical.club?.name);
      const canonicalRole = playerRole(canonical.mainPosition);
      const positionMatch = sourceExactRole ? canonicalRole === sourceExactRole : roleMacro[canonicalRole ?? ""] === sourceRow.sourcePositionGroup;
      const dobMatch = Boolean(sourceRow.birthDate && canonical.birthDate && new Date(`${sourceRow.birthDate}T00:00:00.000Z`).getTime() === canonical.birthDate.getTime());
      const dobConflict = Boolean(sourceRow.birthDate && canonical.birthDate && !dobMatch);
      const score = Math.round(similarity * 50 + (clubMatch ? 30 : 0) + (positionMatch ? 12 : 0) + (dobMatch ? 20 : 0) - (dobConflict ? 25 : 0));
      return { canonical, similarity, exactNormalizedName, clubMatch, positionMatch, dobMatch, dobConflict, score };
    }).filter((candidate) => candidate.similarity >= 0.55 && !candidate.dobConflict).sort((a, b) => b.score - a.score || b.similarity - a.similarity);
    const best = candidates[0] ?? null;
    const runnerUp = candidates[1] ?? null;
    const separated = !runnerUp || best!.score - runnerUp.score >= 8;
    const safe = Boolean(best && separated && best.clubMatch && ((best.similarity >= 0.75 && (best.positionMatch || best.dobMatch)) || best.similarity >= 0.8));
    const status = safe ? "LOCAL_DUPLICATE" : best && (best.similarity >= 0.7 || best.score >= 45) ? "AMBIGUOUS" : "NEEDS_EXTERNAL_IDENTITY_LOOKUP";
    return { seed, sourceRow, best, runnerUp, status, exact: candidates.some((candidate) => candidate.exactNormalizedName), veryHigh: candidates.some((candidate) => !candidate.exactNormalizedName && candidate.similarity >= 0.95) };
  });
  const count = (predicate: (report: (typeof reports)[number]) => boolean) => reports.filter(predicate).length;
  await mkdir(join(process.cwd(), "data", "reports"), { recursive: true });
  const header = ["seedPlayerId", "seedName", "seedKey", "sourceClub", "sourcePosition", "birthDate", "localBestMatch", "localBestTmPlayerId", "localBestClub", "localBestSimilarity", "clubMatch", "positionMatch", "DOBMatch", "runnerUp", "runnerUpTmPlayerId", "status"];
  const lines = reports.sort((a, b) => a.seed.name.localeCompare(b.seed.name)).map(({ seed, sourceRow, best, runnerUp, status }) => [seed.id, seed.name, sourceRow.seedKey, sourceRow.clubName, sourceRow.exactRoleVerified ? sourceRow.mainRole : sourceRow.sourcePositionGroup, sourceRow.birthDate, best?.canonical.name, best?.canonical.tmPlayerId, best?.canonical.club?.name, best?.similarity.toFixed(3), best?.clubMatch, best?.positionMatch, best?.dobMatch, runnerUp?.canonical.name, runnerUp?.canonical.tmPlayerId, status].map(csv).join(","));
  await writeFile(outputPath, `${header.join(",")}\n${lines.join("\n")}\n`);
  console.log(JSON.stringify({ remainingSeeds: reports.length, exactNormalizedNameMatch: count((r) => r.exact), veryHighNameMatch: count((r) => !r.exact && r.veryHigh), other: count((r) => !r.exact && !r.veryHigh), localSafeDuplicates: count((r) => r.status === "LOCAL_DUPLICATE"), needsExternalIdentityLookup: count((r) => r.status === "NEEDS_EXTERNAL_IDENTITY_LOOKUP"), ambiguous: count((r) => r.status === "AMBIGUOUS"), outputPath, lazizbek: reports.find((r) => r.sourceRow.seedKey === "UZ1-2026-LOKOMOTI-031") }, null, 2));
}

try { await main(); } finally { await db.$disconnect(); }
