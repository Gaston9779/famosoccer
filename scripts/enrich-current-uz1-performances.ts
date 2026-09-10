import "dotenv/config";
import { db } from "../src/lib/db";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { configNumber } from "../src/lib/transfermarkt/rateLimiter";
import { savePerformance, markPerformanceChecked } from "../src/lib/services/players";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { currentUz1Performance, hasNumericTmId, isCurrentUz1, isEligible, isPerformanceRequestPath, PerformanceGate, preparePerformances, sportingFields } from "../src/lib/services/uz1-performance-job";

const scope = { club: { competition: { tmCompetitionId: "UZ1" } } };
async function audit() {
  const [total, covered, missing] = await Promise.all([
    db.player.count({ where: scope }),
    db.player.count({ where: { ...scope, performances: { some: currentUz1Performance } } }),
    db.player.findMany({ where: { ...scope, performances: { none: currentUz1Performance } }, select: { id: true, name: true, tmPlayerId: true }, orderBy: [{ tmPlayerId: "asc" }, { id: "asc" }] }),
  ]);
  return { total, covered, eligible: missing.filter(p => hasNumericTmId(p.tmPlayerId)), seedIdentities: missing.filter(p => !hasNumericTmId(p.tmPlayerId)).length };
}

async function execute() {
  const before = await audit();
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const used = await db.syncRun.aggregate({ where: { startedAt: { gte: day } }, _sum: { requestsAttempted: true } });
  const budget = Math.min(50, Math.max(0, configNumber("TM_DAILY_MAX_REQUESTS", 100) - (used._sum.requestsAttempted ?? 0)));
  if (budget < 5 || before.eligible.length < 5) throw new Error("Insufficient budget or eligible players for a five-player canary; no requests made.");
  const run = await db.syncRun.create({ data: { type: "UZ1_2026_PERFORMANCE_CANARY_BATCH", metadata: JSON.stringify({ before: { total: before.total, covered: before.covered, eligible: before.eligible.length }, budget, noRetries: true }) } });
  const gate = new PerformanceGate();
  const results: object[] = [];
  const statuses: Record<string, number> = {};
  let requests = 0, status: number | null = null;
  let improved = 0, currentGained = 0, otherOnly = 0, zeroGain = 0;
  let failure: unknown;
  const client = new TransfermarktClient(run.id, budget, async (input, init) => {
    // Fail closed if a future refactor attempts a profile or a second request.
    const url = new URL(String(input));
    if (!isPerformanceRequestPath(url.pathname) || requests >= budget) throw new Error("Performance request guard rejected request");
    requests++;
    const response = await fetch(input, { ...init, redirect: "manual" });
    status = response.status;
    statuses[String(status)] = (statuses[String(status)] ?? 0) + 1;
    return response;
  }, undefined, { noRetries: true, redirect: "manual" });
  const provider = new TransfermarktProvider(client);
  try {
    for (const candidate of before.eligible) {
      if (gate.stop || requests >= budget) break;
      if (requests >= 5 && !gate.canaryPassed) throw new Error("Canary gate is closed");
      const player = await db.player.findFirst({ where: { id: candidate.id, ...scope, performances: { none: currentUz1Performance } }, include: { performances: true } });
      if (!player || !isEligible(player)) continue;
      status = null;
      let returned = 0, usable = false, current = false, gain = false;
      let fieldsPersisted: object[] = [];
      let errorMessage: string | null = null;
      try {
        const rows = await provider.performance(player.tmPlayerId);
        returned = rows.length;
        const prepared = preparePerformances(rows, player.performances);
        usable = prepared.length > 0;
        current = prepared.some(item => isCurrentUz1(item.row));
        // savePerformance([]) accurately records a successful empty check.
        await savePerformance(player.id, prepared.map(item => item.row));
        fieldsPersisted = prepared.map(({ row, fields }) => ({ season: row.season, competitionKey: row.competitionKey, fields: sportingFields.filter(field => row[field] !== null), changedFields: fields }));
        gain = prepared.some(item => item.fields.length > 0);
        improved += Number(gain);
        currentGained += Number(current);
        otherOnly += Number(usable && !current);
        if (prepared.some(item => isCurrentUz1(item.row) && item.row.minutesPlayedPercent !== null && item.fields.includes("minutesPlayedPercent"))) {
          await calculateAndPersistPlayerOpportunity(player.id);
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        if (error instanceof ProviderError && error.status === 404) await markPerformanceChecked(player.id);
        // Failed writes/scoring, schema errors, network errors and redirects stop this run.
        else { failure = error; gate.stop = errorMessage; }
      }
      zeroGain += Number(!gain);
      gate.record(status, usable, current, gain);
      const result = { player: player.name, tmPlayerId: player.tmPlayerId, httpStatus: status, rowsReturned: returned, currentUz1Returned: current ? "YES" : "NO", fieldsPersisted, usefulGain: gain ? "YES" : "NO", error: errorMessage };
      results.push(result);
      console.log(JSON.stringify({ event: requests <= 5 ? "CANARY_PLAYER" : "BATCH_PLAYER", ...result }));
      await db.syncRun.update({ where: { id: run.id }, data: { metadata: JSON.stringify({ requests, statuses, results, gate }) } });
      if (requests === 5) console.log(JSON.stringify({ event: "CANARY_COMPLETE", passed: gate.canaryPassed, usable: gate.usableCanary, current: gate.currentCanary, stop: gate.stop }));
    }
  } catch (error) { failure = error; }
  finally {
    const after = await audit();
    const report = { runId: run.id, before: `${before.covered} / ${before.total}`, after: `${after.covered} / ${after.total}`, requests, http200: statuses["200"] ?? 0, http404: statuses["404"] ?? 0, http403: statuses["403"] ?? 0, http429: statuses["429"] ?? 0, currentRowsGained: currentGained, coverageDelta: after.covered - before.covered, playersImproved: improved, otherCompetitionsOnly: otherOnly, zeroGainResponses: zeroGain, remainingEligible: after.eligible.length, seedIdentities: after.seedIdentities, canaryPassed: gate.canaryPassed, stop: gate.stop ?? (failure instanceof Error ? failure.message : requests >= budget ? "Request budget reached" : "Candidates exhausted"), transfermarktRequests: requests };
    await finishRun(run.id, failure ?? (gate.stop && gate.stop !== "50-request limit reached" ? new Error(gate.stop) : undefined), { report, results });
    console.log(JSON.stringify({ event: "FINAL_AUDIT", ...report }));
  }
}

try {
  if (process.argv.slice(2).some(arg => !["--execute", "--dry-run"].includes(arg))) throw new Error("Use --dry-run or --execute");
  if (process.argv.includes("--execute") && !process.argv.includes("--dry-run")) await withSyncLock(execute);
  else { const state = await audit(); console.log(JSON.stringify({ dryRun: true, total: state.total, covered: state.covered, missing: state.total - state.covered, eligible: state.eligible.length, seedIdentities: state.seedIdentities, canary: state.eligible.slice(0, 5), externalRequests: 0 }, null, 2)); }
} finally { await db.$disconnect(); }
