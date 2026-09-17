import assert from "node:assert/strict";
import test from "node:test";
import { adjustOpportunity, type Component } from "../src/lib/scoring/playerOpportunity";

const known = (score: number, maxScore: number): Component => ({ score, maxScore, status: "KNOWN", reason: "test" });
const unknown = (maxScore: number): Component => ({ score: null, maxScore, status: "UNKNOWN", reason: "test" });

test("one gap is neutral; two or more gaps receive factor-weighted neutral estimates", () => {
  assert.equal(adjustOpportunity(100, [known(35, 35), known(30, 30), known(15, 15), known(10, 10), known(10, 10)]), 100);
  assert.equal(adjustOpportunity(100, [known(35, 35), known(30, 30), known(15, 15), known(10, 10), unknown(10)]), 100);
  // Unknown contract and representation cannot be represented as either a
  // long deal/agent or as a free agent/no agent: use their conservative priors.
  assert.equal(adjustOpportunity(100, [unknown(35), unknown(30), known(15, 15), known(10, 10), known(10, 10)]), 59);
  assert.equal(adjustOpportunity(100, [unknown(35), unknown(30), unknown(15), known(10, 10), known(10, 10)]), 51);
  assert.equal(adjustOpportunity(null, [unknown(35), unknown(30)]), null);
});
