import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { playerScopeWhere, saveProfile } from "../src/lib/services/players";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { BudgetError, ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";

const REPORT = join(process.cwd(), "data", "reports", "uzb1-player-data-coverage.csv");
const LIMIT = 40;
const FIELDS = ["ROLE", "FOOT", "PHOTO", "CONTRACT", "AGE"] as const;
type Field = (typeof FIELDS)[number];

type ReportRow = Record<string, string>;
type Candidate = { id: string; name: string; tmPlayerId: string; tmUrl: string; coverageCount: number };

function parseCsv(input: string): ReportRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += char; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); records.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); records.push(row); }
  const [headers, ...data] = records;
  return data.filter((values) => values.length === headers.length).map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]])));
}

function selectedFromReport(rows: ReportRow[]): Candidate[] {
  return rows
    .filter((row) => row.hasValidTmIdentity === "true" && row.profileEverSynced === "false" && Number(row.coverageCount) <= 3 && row.coverageBucket === "A")
    .sort((a, b) => Number(a.coverageCount) - Number(b.coverageCount) || a.name.localeCompare(b.name))
    .slice(0, LIMIT)
    .map((row) => ({ id: row.playerId, name: row.name, tmPlayerId: row.tmPlayerId, tmUrl: row.tmUrl, coverageCount: Number(row.coverageCount) }));
}

function presence(player: {
  mainPosition: string | null; preferredFoot: string; portraitUrl: string | null; contractExpires: Date | null; birthDate: Date | null; age: number | null;
}): Record<Field, boolean> {
  return {
    ROLE: Boolean(player.mainPosition?.trim() && player.mainPosition.trim().toUpperCase() !== "UNKNOWN"),
    FOOT: player.preferredFoot === "LEFT" || player.preferredFoot === "RIGHT",
    PHOTO: Boolean(player.portraitUrl?.trim()),
    CONTRACT: player.contractExpires instanceof Date && !Number.isNaN(player.contractExpires.getTime()),
    AGE: (player.birthDate instanceof Date && !Number.isNaN(player.birthDate.getTime())) || player.age !== null,
  };
}

async function loadCoverage(ids: string[]) {
  const players = await db.player.findMany({
    where: { id: { in: ids }, ...playerScopeWhere("UZBEKISTAN") },
    select: { id: true, mainPosition: true, preferredFoot: true, portraitUrl: true, contractExpires: true, birthDate: true, age: true },
  });
  return new Map(players.map((player) => [player.id, presence(player)]));
}

async function main() {
  const candidates = selectedFromReport(parseCsv(await readFile(REPORT, "utf8")));
  if (candidates.length !== LIMIT) throw new Error(`The coverage report only yielded ${candidates.length} eligible players; expected ${LIMIT}.`);
  const before = await loadCoverage(candidates.map((candidate) => candidate.id));
  if (before.size !== LIMIT) throw new Error("A selected report row is no longer an active UZ1 player; regenerate the report before running.");
  const summary = {
    selected: candidates.length, success: 0, partial: 0, failed: 0, requests: 0, blocked403: false, stoppedAfter: null as number | null,
    before: Object.fromEntries(FIELDS.map((field) => [field, [...before.values()].filter((values) => values[field]).length])),
    after: {} as Record<Field, number>, gained: {} as Record<Field, number>, movedAtoC: 0, movedAtoD: 0, remainedA: 0,
    processed: [] as Array<{ id: string; name: string; result: "SUCCESS" | "PARTIAL" | "FAILED"; fieldsGained: Field[] }>,
  };

  await withSyncLock(async () => {
    const run = await db.syncRun.create({ data: { type: "UZ1_COVERAGE_PROFILE_ENRICHMENT", metadata: JSON.stringify({ summary, candidates }) } });
    const provider = new TransfermarktProvider(new TransfermarktClient(run.id, LIMIT));
    const persist = () => db.syncRun.update({ where: { id: run.id }, data: { metadata: JSON.stringify({ summary, candidates }) } });
    let terminal: unknown;
    try {
      for (const [index, candidate] of candidates.entries()) {
        console.log(`[${index + 1}/${LIMIT}] ${candidate.name} - FETCH`);
        try {
          const profile = await provider.fetchPlayerProfile(candidate.tmPlayerId, candidate.tmUrl);
          const player = await saveProfile(profile);
          await db.player.update({ where: { id: player.id }, data: { preferredFootSyncedAt: new Date() } });
          await calculateAndPersistPlayerOpportunity(player.id);
          const afterOne = await loadCoverage([player.id]);
          const fieldsGained = FIELDS.filter((field) => !before.get(player.id)![field] && afterOne.get(player.id)![field]);
          const result = fieldsGained.length ? "SUCCESS" : "PARTIAL";
          summary[result === "SUCCESS" ? "success" : "partial"]++;
          summary.processed.push({ id: player.id, name: candidate.name, result, fieldsGained });
          console.log(`[${index + 1}/${LIMIT}] ${candidate.name} - ${result}`);
        } catch (error) {
          if (error instanceof BudgetError || (error instanceof ProviderError && ["BLOCKED", "CIRCUIT_OPEN", "STOPPED", "NETWORK"].includes(error.code))) {
            terminal = error;
            summary.blocked403 = error instanceof ProviderError && error.status === 403;
            summary.stoppedAfter = index + 1;
            break;
          }
          summary.failed++;
          summary.processed.push({ id: candidate.id, name: candidate.name, result: "FAILED", fieldsGained: [] });
          console.log(`[${index + 1}/${LIMIT}] ${candidate.name} - FAILED: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          const latest = await db.syncRun.findUniqueOrThrow({ where: { id: run.id }, select: { requestsAttempted: true } });
          summary.requests = latest.requestsAttempted;
          await persist();
        }
      }
      await finishRun(run.id, terminal, { summary, candidates });
    } catch (error) {
      await finishRun(run.id, error, { summary, candidates });
      throw error;
    }
  });

  const after = await loadCoverage(candidates.map((candidate) => candidate.id));
  for (const field of FIELDS) {
    summary.after[field] = [...after.values()].filter((values) => values[field]).length;
    summary.gained[field] = summary.after[field] - summary.before[field];
  }
  for (const candidate of candidates) {
    const coverageCount = FIELDS.filter((field) => after.get(candidate.id)?.[field]).length;
    // TEAM is always present for this scope, SPORTING is deliberately untouched.
    const totalCoverage = coverageCount + 1;
    if (totalCoverage === 6) summary.movedAtoD++;
    else if (totalCoverage >= 4) summary.movedAtoC++;
    else summary.remainedA++;
  }
  console.log(JSON.stringify(summary, null, 2));
}

try { await main(); } finally { await db.$disconnect(); }
