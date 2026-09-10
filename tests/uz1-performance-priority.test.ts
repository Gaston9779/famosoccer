import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeAttemptHistory, scoreCandidate, rankCandidates, BATCH_PLAN,
  type RankablePlayer,
} from "../src/lib/services/uz1-performance-priority";

const NOW = new Date("2026-09-10T00:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const player = (over: Partial<RankablePlayer> = {}): RankablePlayer => ({
  id: "p", name: "P", tmPlayerId: "1000",
  careerStatus: "ACTIVE", confirmedFreeAgent: false,
  profileLastSyncedAt: days(2), performanceLastSyncedAt: null,
  clubId: "c", club: { name: "Pakhtakor", lastSyncedAt: days(3) },
  performances: [],
  opportunityHistory: [{ playingTimeScore: null }],
  ...over,
});

test("BATCH_PLAN is canary 5 + 20/25/25/25 = 100", () => {
  assert.deepEqual([...BATCH_PLAN], [5, 20, 25, 25, 25]);
  assert.equal(BATCH_PLAN.reduce((a, b) => a + b, 0), 100);
});

test("scoreCandidate: full rubric for a fresh, never-attempted, authoritative-club player", () => {
  const s = scoreCandidate(player(), { attempts: 0, count404: 0, countZeroGain: 0, countError: 0, lastAt: null, lastResult: null }, NOW);
  // +5 profile synced, +4 authoritative club, +3 never attempted, +2 PT unknown, +1 profile fresh
  assert.equal(s.score, 15);
  assert.equal(s.known404, false);
  assert.equal(s.repeatedFailure, false);
});

test("scoreCandidate: one prior 404 costs -5; two+ failures cost -10 and sink to the bottom", () => {
  const one404 = scoreCandidate(player(), { attempts: 1, count404: 1, countZeroGain: 0, countError: 0, lastAt: "x", lastResult: "EMPTY_404" }, NOW);
  assert.equal(one404.score, 15 - 3 /* not "never attempted" */ - 5 /* one 404 */); // = 7
  assert.equal(one404.known404, true);

  const twoFail = scoreCandidate(player(), { attempts: 2, count404: 1, countZeroGain: 1, countError: 0, lastAt: "x", lastResult: "ZERO_GAIN" }, NOW);
  assert.equal(twoFail.repeatedFailure, true);
  assert.ok(twoFail.score < one404.score);
});

test("scoreCandidate: non-authoritative club state costs -10 and drops 'never attempted' + 'club' credit", () => {
  const noClub = scoreCandidate(player({ clubId: null, club: null }), { attempts: 0, count404: 0, countZeroGain: 0, countError: 0, lastAt: null, lastResult: null }, NOW);
  // +5 profile, +3 never attempted, +2 PT unknown, +1 fresh, -10 stale club  => 1
  assert.equal(noClub.score, 1);
});

test("scoreCandidate: known playing time removes the +2", () => {
  const ptKnown = scoreCandidate(player({ opportunityHistory: [{ playingTimeScore: 12 }] }), { attempts: 0, count404: 0, countZeroGain: 0, countError: 0, lastAt: null, lastResult: null }, NOW);
  assert.equal(ptKnown.score, 13);
});

test("scoreCandidate: a prior performance check with no UZ1 2026 row (performanceLastSyncedAt only) is deprioritised", () => {
  const checkedBefore = scoreCandidate(player({ performanceLastSyncedAt: days(1) }), { attempts: 0, count404: 0, countZeroGain: 0, countError: 0, lastAt: null, lastResult: null }, NOW);
  // loses +3 (not "never attempted") and takes -5 (implied prior miss) => 7
  assert.equal(checkedBefore.score, 7);
  assert.equal(checkedBefore.unproductivePrior, true);
});

test("rankCandidates: excludes covered / seed / retired / free agent; repeated failures sink last", () => {
  const players: RankablePlayer[] = [
    player({ id: "covered", tmPlayerId: "1", performances: [{ season: "2026", competitionKey: "UZ1" }] }),
    player({ id: "seed", tmPlayerId: "seed-abc" }),
    player({ id: "retired", tmPlayerId: "2", careerStatus: "RETIRED" }),
    player({ id: "free", tmPlayerId: "3", careerStatus: "FREE_AGENT" }),
    player({ id: "good", tmPlayerId: "4" }),
    player({ id: "bad", tmPlayerId: "5" }),
  ];
  const history = new Map([["5", { attempts: 3, count404: 2, countZeroGain: 1, countError: 0, lastAt: "x", lastResult: "EMPTY_404" as const }]]);
  const { eligible, excluded } = rankCandidates(players, history, { now: NOW });
  assert.deepEqual(excluded.covered, ["1"]);
  assert.deepEqual(excluded.seedId, ["seed-abc"]);
  assert.deepEqual(excluded.retired, ["2"]);
  assert.deepEqual(excluded.freeAgent, ["3"]);
  assert.deepEqual(eligible.map((s) => s.player.id), ["good", "bad"]); // repeated failure last
});

test("mergeAttemptHistory: reads the new `attempts` shape and the legacy `results` shape", () => {
  const runs = [
    { startedAt: new Date("2026-09-08T00:00:00Z"), metadata: JSON.stringify({ results: [{ tmPlayerId: "10", httpStatus: 404 }, { tmPlayerId: "11", httpStatus: 200, usefulGain: "NO" }] }) },
    { startedAt: new Date("2026-09-09T00:00:00Z"), metadata: JSON.stringify({ attempts: [{ tmPlayerId: "10", at: "2026-09-09T00:00:00Z", status: 404, result: "EMPTY_404" }, { tmPlayerId: "12", at: "2026-09-09T00:01:00Z", status: 200, result: "OK" }] }) },
    { startedAt: new Date("2026-09-07T00:00:00Z"), metadata: null },
    { startedAt: new Date("2026-09-07T12:00:00Z"), metadata: "{not json" },
  ];
  const h = mergeAttemptHistory(runs);
  assert.equal(h.get("10")!.attempts, 2);
  assert.equal(h.get("10")!.count404, 2);
  assert.equal(h.get("10")!.lastResult, "EMPTY_404");
  assert.equal(h.get("11")!.countZeroGain, 1);
  assert.equal(h.get("12")!.attempts, 1);
  assert.equal(h.get("12")!.lastResult, "OK");
});
