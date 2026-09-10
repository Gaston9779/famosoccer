import "dotenv/config";
import { db } from "../src/lib/db";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { configNumber } from "../src/lib/transfermarkt/rateLimiter";
import { savePerformance, markPerformanceChecked } from "../src/lib/services/players";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import {
  currentUz1Performance, isCurrentUz1, isEligible, isPerformanceRequestPath,
  PerformanceGate, preparePerformances, sportingFields,
} from "../src/lib/services/uz1-performance-job";
import {
  mergeAttemptHistory, rankCandidates, BATCH_PLAN,
  type PerformanceAttempt, type RankablePlayer,
} from "../src/lib/services/uz1-performance-priority";

const HARD_CAP = 100;
const scope = { club: { competition: { tmCompetitionId: "UZ1" } } } as const;
const log = (event: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...f }));

const rankableSelect = {
  id: true, name: true, tmPlayerId: true, careerStatus: true, confirmedFreeAgent: true,
  profileLastSyncedAt: true, performanceLastSyncedAt: true, clubId: true,
  club: { select: { name: true, lastSyncedAt: true } },
  performances: { select: { season: true, competitionKey: true } },
  opportunityHistory: { where: { isCurrent: true }, select: { playingTimeScore: true } },
} as const;

async function coverage() {
  const [total, covered] = await Promise.all([
    db.player.count({ where: scope }),
    db.player.count({ where: { ...scope, performances: { some: currentUz1Performance } } }),
  ]);
  return { total, covered };
}

async function loadRanking() {
  const [players, priorRuns] = await Promise.all([
    db.player.findMany({ where: scope, select: rankableSelect }),
    db.syncRun.findMany({
      where: { type: { startsWith: "UZ1_2026_PERFORMANCE" } },
      select: { startedAt: true, metadata: true },
    }),
  ]);
  const history = mergeAttemptHistory(priorRuns);
  const { eligible, excluded } = rankCandidates(players as RankablePlayer[], history);
  return { eligible, excluded, history };
}

async function dryRun() {
  const before = await coverage();
  const { eligible, excluded } = await loadRanking();
  const top100 = eligible.slice(0, HARD_CAP);
  const boundaries = BATCH_PLAN.reduce<number[]>((acc, n) => [...acc, (acc.at(-1) ?? 0) + n], []);
  const batches = BATCH_PLAN.map((n, i) => {
    const start = i === 0 ? 0 : boundaries[i - 1];
    return { label: i === 0 ? "CANARY" : `BATCH ${i}`, size: n, players: top100.slice(start, start + n).map((s) => ({ name: s.player.name, tmPlayerId: s.player.tmPlayerId, score: s.score })) };
  });
  console.log(JSON.stringify({
    dryRun: true,
    coverage: `${before.covered} / ${before.total}`,
    missing: before.total - before.covered,
    eligibleCandidates: eligible.length,
    excluded: {
      alreadyCovered: excluded.covered.length,
      seedIdentities: excluded.seedId.length,
      retired: excluded.retired.length,
      freeAgent: excluded.freeAgent.length,
    },
    known404Candidates: eligible.filter((s) => s.known404).length,
    repeatedFailureCandidates: eligible.filter((s) => s.repeatedFailure).length,
    unproductivePriorCandidates: eligible.filter((s) => s.unproductivePrior).length,
    unproductivePriorInTop100: top100.filter((s) => s.unproductivePrior).length,
    top100Range: { bestScore: top100[0]?.score, worstScore: top100.at(-1)?.score },
    batches,
    externalRequests: 0,
  }, null, 2));
}

async function execute() {
  const before = await coverage();
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const used = (await db.syncRun.aggregate({ where: { startedAt: { gte: day } }, _sum: { requestsAttempted: true } }))._sum.requestsAttempted ?? 0;
  const dailyMax = configNumber("TM_DAILY_MAX_REQUESTS", 100);
  const budget = Math.min(HARD_CAP, Math.max(0, dailyMax - used));
  log("BATCH100_START", { coverageBefore: `${before.covered} / ${before.total}`, dailyMax, usedToday: used, budget });
  if (budget < BATCH_PLAN[0]) {
    log("BATCH100_NO_BUDGET", { message: `Daily Transfermarkt budget exhausted (${used}/${dailyMax}); run again after 00:00 UTC.`, budget });
    return;
  }

  const { eligible } = await loadRanking();
  if (eligible.length < BATCH_PLAN[0]) { log("BATCH100_NO_CANDIDATES", { eligible: eligible.length }); return; }
  const queue = eligible.slice(0, Math.min(HARD_CAP, budget));

  const run = await db.syncRun.create({
    data: {
      type: "UZ1_2026_PERFORMANCE_BATCH100",
      metadata: JSON.stringify({ before: { ...before, eligible: eligible.length }, budget, plan: BATCH_PLAN, noRetries: true }),
    },
  });

  const gate = new PerformanceGate(Math.min(HARD_CAP, budget));
  const attempts: PerformanceAttempt[] = [];
  const results: object[] = [];
  const statuses: Record<string, number> = {};
  let requests = 0, status: number | null = null, failure: unknown;
  let currentGained = 0;
  let playersImproved = 0;
  let otherCompetitionRowsGained = 0;
  let consecutiveNetworkFailures = 0;
  let networkFailures = 0;

  const client = new TransfermarktClient(run.id, Math.min(HARD_CAP, budget), async (input, init) => {
    const url = new URL(String(input));
    if (!isPerformanceRequestPath(url.pathname) || requests >= budget) throw new Error("Performance request guard rejected request");
    requests++;
    const response = await fetch(input, { ...init, redirect: "manual" });
    status = response.status;
    statuses[String(status)] = (statuses[String(status)] ?? 0) + 1;
    return response;
  }, undefined, { noRetries: true, redirect: "manual" });
  const provider = new TransfermarktProvider(client);

  const boundaries = BATCH_PLAN.reduce<number[]>((acc, n) => [...acc, (acc.at(-1) ?? 0) + n], []);
  const batchYields: { label: string; requests: number; gained: number; yield: number }[] = [];

  try {
    for (let b = 0; b < BATCH_PLAN.length; b++) {
      if (gate.stop || requests >= budget) break;
      const label = b === 0 ? "CANARY" : `BATCH ${b}`;
      const start = b === 0 ? 0 : boundaries[b - 1];
      const slice = queue.slice(start, start + BATCH_PLAN[b]);
      const covBatchStart = (await coverage()).covered;
      const reqBatchStart = requests;

      for (const scored of slice) {
        if (gate.stop || requests >= budget) break;
        if (requests >= BATCH_PLAN[0] && !gate.canaryPassed) throw new Error("Canary gate is closed");

        // eligibility rechecked against fresh DB state immediately before the request
        const player = await db.player.findFirst({
          where: { id: scored.player.id, ...scope, performances: { none: currentUz1Performance } },
          include: { performances: true },
        });
        if (!player || !isEligible(player)) continue;

        status = null;
        let returned = 0, usable = false, current = false, gain = false, errorMessage: string | null = null;
        let fieldsPersisted: object[] = [];
        try {
          const rows = await provider.performance(player.tmPlayerId);
          returned = rows.length;
          const prepared = preparePerformances(rows, player.performances);
          usable = prepared.length > 0;
          current = prepared.some((i) => isCurrentUz1(i.row));
          const existingKeys = new Set(player.performances.map((row) => `${row.season}|${row.competitionKey}`));
          otherCompetitionRowsGained += prepared.filter((i) => !isCurrentUz1(i.row) && !existingKeys.has(`${i.row.season}|${i.row.competitionKey}`)).length;
          await savePerformance(player.id, prepared.map((i) => i.row)); // persists ALL competitions; [] records a clean check
          fieldsPersisted = prepared.map(({ row, fields }) => ({ season: row.season, competitionKey: row.competitionKey, stored: sportingFields.filter((f) => row[f] !== null), changed: fields }));
          gain = prepared.some((i) => i.fields.length > 0);
          playersImproved += Number(gain);
          currentGained += Number(current);
          if (prepared.some((i) => isCurrentUz1(i.row) && i.row.minutesPlayedPercent !== null && i.fields.includes("minutesPlayedPercent")))
            await calculateAndPersistPlayerOpportunity(player.id);
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          if (error instanceof ProviderError && error.status === 404) await markPerformanceChecked(player.id);
          else if (error instanceof ProviderError && error.code === "NETWORK") {
            // One transport failure is recorded and skipped without retrying this
            // player. Three in a row indicate an unsafe network condition.
            networkFailures++;
            consecutiveNetworkFailures++;
            if (consecutiveNetworkFailures >= 3) gate.stop = "3 consecutive network failures";
          } else { failure = error; gate.stop = errorMessage; }
        }

        if (!errorMessage || !(errorMessage.includes("Network request failed"))) consecutiveNetworkFailures = 0;

        gate.record(status, usable, current, gain);
        const result: PerformanceAttempt["result"] =
          status === 404 ? "EMPTY_404" : errorMessage ? "ERROR" : gain ? "OK" : "ZERO_GAIN";
        attempts.push({ tmPlayerId: player.tmPlayerId, at: new Date().toISOString(), status, result });
        results.push({ player: player.name, tmPlayerId: player.tmPlayerId, batch: label, httpStatus: status, rowsReturned: returned, currentUz1: current ? "YES" : "NO", usefulGain: gain ? "YES" : "NO", fieldsPersisted, error: errorMessage });
        log(b === 0 ? "CANARY_PLAYER" : "BATCH_PLAYER", { batch: label, player: player.name, tmPlayerId: player.tmPlayerId, httpStatus: status, currentUz1: current, usefulGain: gain });
        await db.syncRun.update({ where: { id: run.id }, data: { metadata: JSON.stringify({ requests, statuses, attempts, results, gate, batchYields }) } });
      }

      const covBatchEnd = (await coverage()).covered;
      const gained = covBatchEnd - covBatchStart;
      const batchRequests = requests - reqBatchStart;
      const y = batchRequests ? gained / batchRequests : 0;
      batchYields.push({ label, requests: batchRequests, gained, yield: Number(y.toFixed(3)) });
      log("BATCH_COMPLETE", { batch: label, requests: batchRequests, uz1RowsGained: gained, yield: Number((y * 100).toFixed(1)) });

      // yield gate (task rules)
      const cumGained = covBatchEnd - before.covered;
      const cumYield = requests ? cumGained / requests : 0;
      if (b === 0) {
        if (!gate.canaryPassed) { gate.stop ??= "Canary failed"; break; }
      } else if (batchRequests > 0 && y < 0.2) {
        gate.stop = `Batch yield ${(y * 100).toFixed(1)}% < 20%`;
        break;
      } else if (requests >= 10 && cumYield < 0.4) {
        gate.stop = `Cumulative yield ${(cumYield * 100).toFixed(1)}% < 40%`;
        break;
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    const after = await coverage();
    const priorForNext = await loadRanking();
    const report = {
      runId: run.id,
      coverageBefore: `${before.covered} / ${before.total}`,
      coverageAfter: `${after.covered} / ${after.total}`,
      uz1RowsGained: after.covered - before.covered,
      requests,
      overallYield: requests ? Number(((after.covered - before.covered) / requests).toFixed(3)) : 0,
      canaryPassed: gate.canaryPassed,
      batchYields,
      http: statuses,
      http200: statuses["200"] ?? 0,
      http404: statuses["404"] ?? 0,
      http403: statuses["403"] ?? 0,
      http429: statuses["429"] ?? 0,
      currentRowsGained: currentGained,
      playersImproved,
      otherCompetitionRowsGained,
      networkFailures,
      known404Total: attempts.filter((a) => a.result === "EMPTY_404").length,
      zeroGainTotal: attempts.filter((a) => a.result === "ZERO_GAIN").length,
      canary: { http200: gate.http200Canary, useful: gate.usableCanary, currentUz1: gate.currentCanary },
      stop: gate.stop ?? (failure instanceof Error ? failure.message : requests >= budget ? "Budget reached" : "Queue exhausted"),
      remainingEligible: priorForNext.eligible.length,
      nextDayTop: priorForNext.eligible.slice(0, 10).map((s) => ({ name: s.player.name, tmPlayerId: s.player.tmPlayerId, score: s.score })),
      transfermarktRequests: requests,
    };
    await finishRun(run.id, failure ?? (gate.stop && !/limit reached|Budget reached|Queue exhausted/.test(gate.stop) ? new Error(gate.stop) : undefined), { report, attempts, results });
    await db.syncRun.update({ where: { id: run.id }, data: { metadata: JSON.stringify({ requests, statuses, attempts, results, gate, batchYields, report }) } });
    log("FINAL_REPORT", report);
  }
}

try {
  const args = process.argv.slice(2);
  if (!args.every((a) => ["--execute", "--dry-run"].includes(a))) throw new Error("Use --dry-run or --execute");
  if (args.includes("--execute") && !args.includes("--dry-run")) await withSyncLock(execute);
  else await dryRun();
} finally {
  await db.$disconnect();
}
