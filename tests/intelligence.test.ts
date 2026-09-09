import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scoreContractOpportunity,
  scoreRepresentationOpportunity,
  scorePlayingTimeOpportunity,
  scoreAgeOpportunity,
  scoreMarketAccessibility,
  calculateConfidence,
  calculatePlayerOpportunity,
  currentScoringPerformance,
} from "../src/lib/scoring/playerOpportunity";
import { normalizeRole, secondaryRoles } from "../src/lib/scoring/roles";
import { calculateClubNeed } from "../src/lib/scoring/clubNeed";
import { calculatePlayerClubMatch } from "../src/lib/scoring/playerClubMatch";
import {
  snapshotChanges,
  scoreChangeEvent,
} from "../src/lib/intelligence/events";
import { playerAge, type IntelligencePlayer } from "../src/lib/scoring/types";
import { addMonths } from "../src/lib/scoring/config";
import { formatPercentage } from "../src/lib/presentation";
const now = new Date("2026-09-06T12:00:00Z");
const fixture = JSON.parse(
  readFileSync("tests/fixtures/intelligence/uzbekistan.local.json", "utf8"),
  (_key, value) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
      ? new Date(value)
      : value,
) as { players: IntelligencePlayer[]; season: string };
const sample = fixture.players.find((p) => p.tmPlayerId === "481513")!;
const base: IntelligencePlayer = {
  ...sample,
  profileLastSyncedAt: now,
  performanceLastSyncedAt: now,
  performances: sample.performances.map((p) => ({
    ...p,
    sourceUpdatedAt: now,
  })),
  clubId: "club",
  birthDate: null,
  age: 24,
};
const after = (days: number) => new Date(now.getTime() + days * 86400000);
test("contract opportunity: exact thresholds, statuses and unavailable contract data", () => {
  for (const [days, expected] of [
    [179, 32],
    [180, 28],
    [365, 28],
    [366, 24],
    [420, 24],
    [421, 12],
    [547, 12],
    [548, 5],
    [730, 5],
    [731, 0],
    [-1, 0],
  ])
    assert.equal(scoreContractOpportunity(after(days), now).score, expected);
  assert.equal(scoreContractOpportunity(null, now, false, null).score, null);
  assert.equal(scoreContractOpportunity(null, now, true, null).score, 35);
  assert.equal(scoreContractOpportunity(null, now, true, "club").score, 35);
  assert.equal(scoreContractOpportunity(null, now, false, null, "FREE_AGENT").score, 35);
  assert.equal(scoreContractOpportunity(null, now, false, null, "RETIRED").score, null);
  assert.equal(scoreContractOpportunity(null, now, false, null, "UNKNOWN").score, null);
  assert.equal(scoreContractOpportunity(null, now, true, null, "RETIRED").score, 0);
  assert.equal(scoreContractOpportunity(new Date("invalid"), now).score, null);
  assert.equal(
    scoreContractOpportunity(null, now).warning,
    "Contract expiry unavailable",
  );
});
test("representation weights keep absence distinct from no agent", () => {
  for (const [status, score] of Object.entries({
    NO_AGENT: 30,
    FAMILY: 28,
    NOT_LISTED: 23,
    UNKNOWN: 15,
    AGENCY: 0,
  }))
    assert.equal(
      scoreRepresentationOpportunity(
        status as IntelligencePlayer["representationStatus"],
      ).score,
      score,
    );
  assert.match(
    scoreRepresentationOpportunity("NOT_LISTED").warning!,
    /does not mean no agent/,
  );
});
test("playing-time score boundaries and invalid values", () => {
  for (const [pct, score] of [
    [0, 0],
    [9.99, 0],
    [10, 3],
    [24.99, 3],
    [25, 8],
    [41.111111, 8],
    [49.99, 8],
    [50, 12],
    [74.99, 12],
    [75, 15],
    [100, 15],
    [-1, 0],
    [101, 0],
  ])
    assert.equal(scorePlayingTimeOpportunity(pct).score, score);
  assert.equal(
    scorePlayingTimeOpportunity(null).warning,
    "Playing time unavailable",
  );
});
test("percentage display rounds to one decimal without floating-point noise", () => {
  assert.equal(formatPercentage(41.11111111111111), "41.1%");
  assert.equal(formatPercentage(40.28), "40.3%");
  assert.equal(formatPercentage(64.5), "64.5%");
  assert.equal(formatPercentage(100), "100%");
});
test("age score boundaries and minors", () => {
  for (const [age, score] of [
    [17, 0],
    [18, 10],
    [21, 10],
    [22, 8],
    [24, 8],
    [25, 5],
    [27, 5],
    [28, 2],
    [30, 2],
    [31, 0],
  ])
    assert.equal(scoreAgeOpportunity(age).score, score);
  assert.equal(scoreAgeOpportunity(17).warning, "Minor player");
  assert.equal(
    playerAge({ birthDate: new Date("2000-09-07"), age: 99 }, now),
    25,
  );
});
test("market accessibility boundaries and unknown values", () => {
  for (const [value, score] of [[100000,10],[100001,9],[250000,9],[250001,8],[500000,8],[500001,7],[750000,7],[750001,6],[1000000,6],[1000001,4],[2000000,4],[2000001,3],[3000000,3],[3000001,2],[5000000,2],[5000001,1]]) assert.equal(scoreMarketAccessibility(value).score, score);
  assert.equal(scoreMarketAccessibility(null).score, null);
});
test("confidence is independent, explains freshness and rejects prior-season performance", () => {
  assert.equal(calculateConfidence(base, "2026", now).total, 100);
  const stale = {
    ...base,
    profileLastSyncedAt: after(-31),
    performanceLastSyncedAt: after(-31),
    performances: base.performances.map((p) => ({
      ...p,
      sourceUpdatedAt: after(-31),
    })),
  };
  assert.equal(calculateConfidence(stale, "2026", now).total, 100);
  assert.equal(
    calculatePlayerOpportunity(stale, "2026", now).total,
    calculatePlayerOpportunity(base, "2026", now).total,
  );
  assert.equal(
    currentScoringPerformance(
      {
        ...base,
        performances: base.performances.map((p) => ({ ...p, season: "2025" })),
      },
      "2026",
      now,
    ),
    null,
  );
  assert.equal(currentScoringPerformance(base, null, now), null);
});
test("exact role mapping uses profile text, second striker and secondary roles", () => {
  for (const [raw, role] of [
    ["Goalkeeper", "GK"],
    ["Defender - Right-Back", "RB"],
    ["Left-Back", "LB"],
    ["Centre-Back", "CB"],
    ["Defensive Midfield", "DM"],
    ["Central Midfield", "CM"],
    ["Attacking Midfield", "AM"],
    ["Right Winger", "RW"],
    ["Left Winger", "LW"],
    ["Centre-Forward", "ST"],
    ["Second Striker", "ST"],
    ["Defender", "CB"],
    ["Midfield", "CM"],
    ["Midfielder", "CM"],
    ["Attack", "ST"],
    ["Forward", "ST"],
  ])
    assert.equal(normalizeRole(raw), role);
  assert.deepEqual(secondaryRoles('["Right Winger","Right Winger","Alien"]'), [
    "RW",
  ]);
  assert.deepEqual(secondaryRoles("malformed"), []);
});
test("real local Kouao opportunity breakdown is deterministic", () => {
  const player = {
    ...sample,
    profileLastSyncedAt: now,
    performanceLastSyncedAt: now,
    performances: sample.performances.map((p) => ({
      ...p,
      sourceUpdatedAt: now,
    })),
  };
  const score = calculatePlayerOpportunity(player, "2026", now);
  assert.deepEqual(
    [
      score.contractScore,
      score.representationScore,
      score.playingTimeScore,
      score.ageScore,
      score.marketAccessibilityScore,
    ],
    [12, 0, 8, 2, 2],
  );
  assert.equal(score.total, 24);
  assert.equal(score.confidence, 100);
});
test("club depth projects expiring players, contract risk and robust calendar months", () => {
  const squad = [
    {
      ...base,
      id: "1",
      mainPosition: "Right-Back",
      contractExpires: after(30),
    },
    {
      ...base,
      id: "2",
      mainPosition: "Right-Back",
      contractExpires: after(800),
    },
  ];
  const need = calculateClubNeed("club", "RB", squad, now, now);
  assert.equal(need.currentDepth, 2);
  assert.equal(need.projectedDepth12Months, 1);
  assert.equal(need.depthScore, 20);
  assert.equal(need.contractRiskScore, 15);
  assert.equal(need.expiring6Months, 1);
  assert.equal(need.ageRiskScore, 0);
  assert.equal(
    addMonths(new Date("2024-08-31T00:00:00Z"), 6).toISOString().slice(0, 10),
    "2025-02-28",
  );
});
test("unimported rosters and unknown roles cannot fabricate shortages", () => {
  const missing = calculateClubNeed("club", "CB", [], now, null);
  assert.equal(missing.available, false);
  assert.equal(missing.total, 0);
  const incomplete = calculateClubNeed(
    "club",
    "CB",
    [{ ...base, mainPosition: null }],
    now,
    now,
  );
  assert.equal(incomplete.depthScore, 30);
  assert.equal(incomplete.unknownRoleCount, 1);
  assert.ok(incomplete.warnings.length);
  const fullUnclassified = calculateClubNeed(
    "club",
    "RB",
    Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: String(i),
      mainPosition: null,
    })),
    now,
    now,
  );
  assert.equal(fullUnclassified.depthScore, 0);
});
test("club age risk is composition based; value concentration remains a proxy", () => {
  const squad = Array.from({ length: 4 }, (_, i) => ({
    ...base,
    id: String(i),
    mainPosition: "Centre-Back",
    age: i === 0 ? 34 : 23,
    marketValueEur: i === 0 ? 1000000 : 10000,
    contractExpires: after(800),
  }));
  const need = calculateClubNeed("club", "CB", squad, now, now);
  assert.ok(need.ageRiskScore < 10);
  assert.ok(need.qualityDepthScore > 8);
  const even = calculateClubNeed(
    "club",
    "CB",
    squad.map((p) => ({ ...p, marketValueEur: 500000 })),
    now,
    now,
  );
  assert.equal(even.qualityDepthScore, 0);
});
test("match formula, secondary fit, exclusions and neutral missing market context", () => {
  const need = calculateClubNeed("other", "RB", [], now, now);
  const assessed = { ...need, available: true, total: 60 };
  const match = calculatePlayerClubMatch(base, assessed, 50, [], now)!;
  assert.equal(match.positionFit, 100);
  assert.equal(match.ageFit, 100);
  assert.equal(match.marketFit, 50);
  assert.equal(match.matchScore, 66);
  assert.equal(
    calculatePlayerClubMatch(
      base,
      { ...assessed, clubId: "club" },
      50,
      [],
      now,
    ),
    null,
  );
  assert.equal(
    calculatePlayerClubMatch(
      { ...base, mainPosition: null },
      assessed,
      50,
      [],
      now,
    ),
    null,
  );
  assert.equal(
    calculatePlayerClubMatch({ ...base, name: "" }, assessed, 50, [], now),
    null,
  );
  assert.equal(
    calculatePlayerClubMatch(
      {
        ...base,
        mainPosition: "Left-Back",
        secondaryPositions: '["Right-Back"]',
      },
      assessed,
      50,
      [],
      now,
    )?.positionFit,
    75,
  );
  assert.equal(
    calculatePlayerClubMatch(
      { ...base, mainPosition: "Centre-Forward", secondaryPositions: null },
      assessed,
      50,
      [],
      now,
    ),
    null,
  );
  const context = Array.from({ length: 5 }, (_, i) => ({
    ...base,
    id: String(i),
    clubId: "other",
    marketValueEur: 100000,
  }));
  assert.equal(
    calculatePlayerClubMatch(
      { ...base, marketValueEur: 100000 },
      assessed,
      50,
      context,
      now,
    )?.marketFit,
    100,
  );
});
test("meaningful snapshot changes and club join/leave transitions", () => {
  const first = {
    id: "a",
    playerId: "p",
    contractExpires: null,
    representationStatus: "NO_AGENT",
    agencyName: null,
    marketValueEur: null,
    clubId: "a",
  };
  assert.equal(snapshotChanges(first, { ...first, id: "b" }).length, 0);
  assert.deepEqual(
    snapshotChanges(first, {
      ...first,
      id: "b",
      agencyName: "Team Anchor",
      representationStatus: "AGENCY",
      contractExpires: after(800),
      marketValueEur: 200000,
      clubId: "b",
    }).map((e) => e.type),
    [
      "AGENCY_CHANGED",
      "REPRESENTATION_STATUS_CHANGED",
      "CONTRACT_CHANGED",
      "MARKET_VALUE_CHANGED",
      "CLUB_CHANGED",
    ],
  );
  assert.equal(
    snapshotChanges(first, { ...first, clubId: null })[0].type,
    "PLAYER_LEFT_CLUB",
  );
  assert.equal(
    snapshotChanges({ ...first, clubId: null }, first)[0].type,
    "PLAYER_JOINED_CLUB",
  );
});
test("score events require ten points and a previous observation", () => {
  assert.equal(scoreChangeEvent("OPPORTUNITY_SCORE", null, 80), null);
  assert.equal(scoreChangeEvent("OPPORTUNITY_SCORE", 50, 59), null);
  assert.equal(
    scoreChangeEvent("OPPORTUNITY_SCORE", 50, 60)?.type,
    "OPPORTUNITY_SCORE_INCREASED",
  );
  assert.equal(
    scoreChangeEvent("CLUB_NEED", 70, 60)?.type,
    "CLUB_NEED_DECREASED",
  );
});
