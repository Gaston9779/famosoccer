import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { playerUrl, tmapiPerformanceUrl } from "../src/lib/transfermarkt/endpoints";
import { parseProfile } from "../src/lib/transfermarkt/parsers/profile";
import { parsePerformance } from "../src/lib/transfermarkt/parsers/performance";

type JsonRecord = Record<string, unknown>;
type Dataset = { players: JsonRecord[]; performances: JsonRecord[] };
type Checkpoint = {
  successTmPlayerIds: string[]; failedTmPlayerIds: string[];
  attempted: number; success: number; failed: number;
  profileFieldsFilled: number; sportingRowsAdded: number; startedAt: string;
  updatedAt?: string; stoppedReason?: string;
};

const dir = "src/data/import/ita-expat";
const defaults = {
  input: `${dir}/famosoccer_italiani_estero_2026_27_PARTIAL_CORRETTO_MAX.json`,
  output: `${dir}/famosoccer_italiani_estero_2026_27_ENRICHED_FULL.json`,
  checkpoint: `${dir}/.ita-unified-enrichment-checkpoint.json`,
};
function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
function limitArg() {
  const index = process.argv.indexOf("--limit");
  if (index === -1) return Infinity;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("--limit must be a positive integer");
  return value;
}
const meaningful = (value: unknown) => value !== null && value !== undefined && value !== "" && value !== "[]" && value !== "UNKNOWN";
const newCheckpoint = (): Checkpoint => ({
  successTmPlayerIds: [], failedTmPlayerIds: [], attempted: 0, success: 0, failed: 0,
  profileFieldsFilled: 0, sportingRowsAdded: 0, startedAt: new Date().toISOString(),
});

async function main() {
  const input = arg("--input", defaults.input);
  const output = arg("--output", defaults.output);
  const checkpointPath = arg("--checkpoint", defaults.checkpoint);
  const limit = limitArg();
  const data: Dataset = JSON.parse(readFileSync(existsSync(output) ? output : input, "utf8"));
  const checkpoint: Checkpoint = existsSync(checkpointPath)
    ? JSON.parse(readFileSync(checkpointPath, "utf8")) : newCheckpoint();
  const successful = new Set(checkpoint.successTmPlayerIds);
  const save = (reason?: string) => {
    checkpoint.updatedAt = new Date().toISOString();
    if (reason) checkpoint.stoppedReason = reason;
    writeFileSync(output, JSON.stringify(data, null, 2));
    writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  };

  let attemptsThisRun = 0;
  let stopReason: string | null = null;
  for (const [playerIndex, player] of data.players.entries()) {
    if (attemptsThisRun >= limit || stopReason) break;
    const tmPlayerId = String(player.tmPlayerId ?? "");
    if (!/^[0-9]+$/.test(tmPlayerId) || successful.has(tmPlayerId)) continue;
    attemptsThisRun++;
    checkpoint.attempted++;
    const name = String(player.name ?? tmPlayerId);
    let profileFieldsFilled = 0;
    let sportingRows = 0;
    let failed = false;
    let blocked = false;
    console.log(`[${playerIndex + 1}/${data.players.length}] ${name}`);
    console.log(`tmPlayerId: ${tmPlayerId}`);

    try {
      const path = playerUrl(String(player.tmUrl ?? "")).path;
      const response = await fetch(`https://www.transfermarkt.it${path}`);
      if (!response.ok) {
        console.log(`profile: FAILED HTTP ${response.status}`);
        failed = true;
        blocked = response.status === 403 || response.status === 429;
      } else {
        const parsed = parseProfile(await response.text(), tmPlayerId, String(player.tmUrl ?? "")) as JsonRecord;
        for (const [field, value] of Object.entries(parsed))
          if (meaningful(value) && !meaningful(player[field])) {
            player[field] = value;
            profileFieldsFilled++;
          }
        console.log("profile: SUCCESS");
      }
    } catch (error) {
      failed = true;
      console.log(`profile: FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`profile fields filled: ${profileFieldsFilled}`);

    if (!blocked) {
      try {
        const response = await fetch(`https://tmapi.transfermarkt.technology${tmapiPerformanceUrl(tmPlayerId).path}`);
        if (!response.ok) {
          console.log(`sporting: FAILED HTTP ${response.status}`);
          failed = true;
          blocked = response.status === 403 || response.status === 429;
        } else {
          const rows = parsePerformance(await response.text()) as unknown as JsonRecord[];
          for (const row of rows) {
            const index = data.performances.findIndex((performance) =>
              performance.playerId === player.id &&
              performance.season === row.season &&
              performance.competitionKey === row.competitionKey,
            );
            if (index === -1) {
              data.performances.push({
                ...row, id: `ita_perf_${tmPlayerId}_${String(row.season)}_${String(row.competitionKey)}`,
                playerId: player.id,
              });
            } else {
              data.performances[index] = {
                ...data.performances[index],
                ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined)),
              };
            }
            sportingRows++;
          }
          console.log("sporting: SUCCESS");
        }
      } catch (error) {
        failed = true;
        console.log(`sporting: FAILED ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log("sporting: SKIPPED after profile block");
    }
    console.log(`sporting rows: ${sportingRows}`);

    checkpoint.profileFieldsFilled += profileFieldsFilled;
    checkpoint.sportingRowsAdded += sportingRows;
    if (failed) {
      checkpoint.failed++;
      if (!checkpoint.failedTmPlayerIds.includes(tmPlayerId)) checkpoint.failedTmPlayerIds.push(tmPlayerId);
      console.log("result: FAILED");
    } else {
      checkpoint.success++;
      successful.add(tmPlayerId);
      checkpoint.successTmPlayerIds.push(tmPlayerId);
      checkpoint.failedTmPlayerIds = checkpoint.failedTmPlayerIds.filter((id) => id !== tmPlayerId);
      console.log("result: SUCCESS");
    }
    if (blocked) stopReason = "HTTP 403/429";
    save(stopReason ?? undefined);
  }
  console.log(JSON.stringify({
    attemptsThisRun, successes: checkpoint.successTmPlayerIds.length,
    failedPendingRetry: checkpoint.failedTmPlayerIds.length,
    profileFieldsFilled: checkpoint.profileFieldsFilled,
    sportingRowsAddedOrUpdated: checkpoint.sportingRowsAdded,
    output, checkpoint: checkpointPath,
    stopReason: stopReason ?? (attemptsThisRun >= limit ? "limit reached" : "queue exhausted"),
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
