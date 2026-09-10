import assert from "node:assert/strict";
import { test } from "node:test";
import { currentUz1Sporting, displayPercent, displayStat } from "../src/components/player-sporting-card";

test("Sporting selects only the current UZ1 2026 row", () => {
  const rows = [
    { season: "2026", competitionKey: "KOBU", value: "cup" },
    { season: "2025", competitionKey: "UZ1", value: "old" },
    { season: "2026", competitionKey: "UZ1", value: "current" },
  ];
  assert.equal(currentUz1Sporting(rows)?.value, "current");
});

test("Sporting displays null as a dash and preserves real zeroes", () => {
  assert.equal(displayStat(null), "–");
  assert.equal(displayStat(undefined), "–");
  assert.equal(displayStat(0), "0");
  assert.equal(displayPercent(null), "–");
  assert.equal(displayPercent(0), "0%");
  assert.equal(displayPercent(77.543), "77.5%");
});
