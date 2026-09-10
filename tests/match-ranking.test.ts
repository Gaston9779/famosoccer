import test from "node:test";
import assert from "node:assert/strict";
import { groupMatchesByPlayer } from "../src/lib/intelligence/match-ranking";

test("one row per player chooses the highest match and preserves all other club/role opportunities", () => {
  const matches = [
    { playerId: "abbosbek", clubId: "navbahor", role: "CM", matchScore: 77.3 },
    { playerId: "other", clubId: "dinamo", role: "DM", matchScore: 90 },
    { playerId: "abbosbek", clubId: "pakhtakor", role: "DM", matchScore: 81.1 },
    { playerId: "abbosbek", clubId: "navbahor", role: "DM", matchScore: 85.4 },
  ];
  const groups = groupMatchesByPlayer(matches);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].playerId, "other");
  assert.deepEqual(groups[1].bestMatchForPlayer, matches[3]);
  assert.equal(groups[1].additionalMatches.length, 2);
  assert.deepEqual(groups[1].matches.map(m => m.matchScore), [85.4, 81.1, 77.3]);
  assert.equal(matches[0].matchScore, 77.3);
});

test("ranking is deterministic for ties and empty inputs", () => {
  assert.deepEqual(groupMatchesByPlayer([]), []);
  const matches = [
    { playerId: "a", clubId: "z", role: "DM", matchScore: 81.1 },
    { playerId: "a", clubId: "b", role: "DM", matchScore: 81.1 },
    { playerId: "a", clubId: "b", role: "CM", matchScore: 81.1 },
  ];
  assert.deepEqual(groupMatchesByPlayer(matches), groupMatchesByPlayer([...matches].reverse()));
  assert.deepEqual(groupMatchesByPlayer(matches)[0].bestMatchForPlayer, matches[2]);
});
