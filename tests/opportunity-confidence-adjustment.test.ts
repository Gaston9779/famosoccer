import assert from "node:assert/strict";
import test from "node:test";
import { adjustOpportunity } from "../src/lib/scoring/playerOpportunity";

test("confidence-adjusted opportunity pulls raw scores toward neutral", () => {
  const cases: Array<[string, number | null, number, number | null]> = [
    ["full confidence", 100, 1, 100],
    ["market value missing", 100, 0.9, 95],
    ["playing time missing", 100, 0.85, 92.5],
    ["contract missing", 100, 0.65, 82.5],
    ["contract and value missing", 100, 0.55, 77.5],
    ["only age known", 100, 0.1, 55],
    ["low raw and low confidence", 20, 0.1, 47],
    ["no known data", null, 0, null],
  ];
  for (const [label, raw, confidence, expected] of cases)
    assert.equal(adjustOpportunity(raw, confidence), expected, label);
});
