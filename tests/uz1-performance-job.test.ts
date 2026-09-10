import test from "node:test";
import assert from "node:assert/strict";
import { PerformanceGate, preparePerformances, isCurrentUz1, isEligible, hasNumericTmId, isPerformanceRequestPath, sportingFields } from "../src/lib/services/uz1-performance-job";
import type { Performance } from "../src/lib/transfermarkt/types";

const row = (overrides: Partial<Performance> = {}): Performance => ({
  season: "2026", competitionKey: "UZ1", competitionCode: "UZ1", competitionName: "Superliga",
  ...Object.fromEntries(sportingFields.map(field => [field, null])), ...overrides,
} as Performance);

test("coverage excludes cup, other leagues and seasons", () => {
  assert.equal(isCurrentUz1(row()), true);
  for (const change of [{ season: "2025" }, { competitionKey: "KOBU" }, { competitionKey: "UZ2L" }, { competitionKey: "ACEQ" }]) assert.equal(isCurrentUz1(row(change)), false);
});

test("dashboard coverage counts only the current UZ1 2026 league row", () => {
  const mixed = [row(), row({ competitionKey: "KOBU" }), row({ season: "2025" }), row({ season: "26/27", competitionKey: "ACEQ" }), row({ competitionKey: "UZ2L" })];
  assert.equal(mixed.filter(isCurrentUz1).length, 1);
  assert.equal([row({ competitionKey: "KOBU" })].some(isCurrentUz1), false);
});

test("eligibility: valid numeric id and no UZ1 2026 row; cup-only stays eligible; already-covered and seed ids excluded", () => {
  // valid numeric id, no UZ1 2026 row -> eligible
  assert.equal(isEligible({ tmPlayerId: "12345", performances: [] }), true);
  // cup-only (KOBU) player -> still eligible
  assert.equal(isEligible({ tmPlayerId: "12345", performances: [row({ competitionKey: "KOBU" })] }), true);
  // other-season UZ1 -> still eligible
  assert.equal(isEligible({ tmPlayerId: "12345", performances: [row({ season: "2025" })] }), true);
  // already has UZ1 2026 -> excluded
  assert.equal(isEligible({ tmPlayerId: "12345", performances: [row()] }), false);
  // non-numeric (seed) identity -> excluded regardless of performances
  assert.equal(hasNumericTmId("seed-abdulla-1"), false);
  assert.equal(isEligible({ tmPlayerId: "seed-abdulla-1", performances: [] }), false);
});

test("the job may only request the performance endpoint, never a profile or any other path", () => {
  assert.equal(isPerformanceRequestPath("/player/12345/performance-game"), true);
  for (const path of [
    "/player/profil/spieler/12345",
    "/player/abc/performance-game",
    "/player/12345/performance-game/extra",
    "/ceapi/player/12345/performance",
    "/quickselect/players/12345",
    "/",
  ]) assert.equal(isPerformanceRequestPath(path), false);
});

test("canary requires three HTTP 200 responses and three usable/current responses", () => {
  const pass = new PerformanceGate();
  for (let i = 0; i < 5; i++) pass.record(200, i < 3, i < 3, i < 3);
  assert.equal(pass.canaryPassed, true); assert.equal(pass.stop, null);
  const fail = new PerformanceGate();
  for (let i = 0; i < 5; i++) fail.record(200, i < 2, i < 2, i < 2);
  assert.equal(fail.canaryPassed, false); assert.equal(fail.stop, "Canary failed");
  const otherOnly = new PerformanceGate();
  for (let i = 0; i < 5; i++) otherOnly.record(200, true, false, true);
  assert.equal(otherOnly.canaryPassed, true);
  assert.equal(otherOnly.stop, null);

  const non200 = new PerformanceGate();
  for (let i = 0; i < 5; i++) non200.record(404, true, true, true);
  assert.equal(non200.canaryPassed, false);
});

test("immediate blocks, consecutive 404, zero gain and hard request cap", () => {
  for (const status of [403, 429]) { const gate = new PerformanceGate(); gate.record(status, false, false, false); assert.equal(gate.stop, `HTTP ${status}`); }
  const missing = new PerformanceGate();
  missing.record(404, false, false, false); missing.record(200, true, true, true);
  for (let i = 0; i < 3; i++) missing.record(404, false, false, false);
  assert.equal(missing.stop, "3 consecutive HTTP 404");
  const empty = new PerformanceGate();
  for (let i = 0; i < 5; i++) empty.record(200, false, false, false);
  assert.equal(empty.stop, "5 consecutive HTTP 200 with zero useful data");
  const zeroGain = new PerformanceGate();
  for (let i = 0; i < 5; i++) zeroGain.record(200, true, true, false);
  assert.equal(zeroGain.stop, "5 consecutive zero-gain responses");
  const capped = new PerformanceGate();
  for (let i = 0; i < 50; i++) capped.record(200, true, true, true);
  assert.equal(capped.stop, "50-request limit reached");
});

test("empty fields preserve stored statistics, zero is valid, invalid values are rejected", () => {
  const existing = row({ gamesPlayed: 10, minutesPlayed: 450, minutesPlayedPercent: 25 });
  assert.deepEqual(preparePerformances([row()], [existing]), []);
  const [saved] = preparePerformances([row({ goals: 0, gamesPlayed: -1, minutesPlayedPercent: 101 })], [existing]);
  assert.equal(saved.row.gamesPlayed, 10); assert.equal(saved.row.minutesPlayed, 450);
  assert.equal(saved.row.minutesPlayedPercent, 25); assert.equal(saved.row.goals, 0);
  assert.deepEqual(saved.fields, ["goals"]);
  assert.deepEqual(preparePerformances([existing], [existing])[0].fields, []);
  assert.equal(preparePerformances([row({ gamesPlayed: 1.5 })], []).length, 0);
  const rows = preparePerformances([row({ gamesPlayed: 3 }), row({ competitionKey: "KOBU", gamesPlayed: 1 })], []);
  assert.equal(rows.length, 2);
});
