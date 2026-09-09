import assert from "node:assert/strict";
import test from "node:test";
import {
  planPlayerEnrichment,
  selectWithinRequestBudget,
  type EnrichmentCandidate,
} from "../src/lib/services/player-enrichment";

const now = new Date("2026-09-08T12:00:00.000Z");
const candidate = (overrides: Partial<EnrichmentCandidate> = {}): EnrichmentCandidate => ({
  id: "player-1",
  tmPlayerId: "1",
  tmUrl: "https://www.transfermarkt.com/test/profil/spieler/1",
  name: "Player",
  portraitUrl: "https://example.test/portrait.jpg",
  birthDate: new Date("2000-01-01"),
  age: 26,
  mainPosition: "Centre-Back",
  contractExpires: new Date("2027-06-30"),
  marketValueEur: 100000,
  representationStatus: "AGENCY",
  confirmedFreeAgent: false,
  profileLastSyncedAt: now,
  performanceLastSyncedAt: now,
  club: { competition: { tmCompetitionId: "OTHER" } },
  performances: [{ id: "performance-1" }],
  opportunityHistory: [{ id: "opportunity-1" }],
  ...overrides,
});

test("complete recent player is skipped, while missing profile or performance is selected", () => {
  const plan = planPlayerEnrichment([
    candidate(),
    candidate({ id: "portrait", tmPlayerId: "2", portraitUrl: null }),
    candidate({ id: "performance", tmPlayerId: "3", performances: [] }),
  ], now);
  assert.deepEqual(plan.map((player) => player.id), ["portrait", "performance"]);
  assert.equal(plan[0].needsProfile, true);
  assert.equal(plan[1].needsPerformance, true);
});

test("a missing current opportunity is selected for recalculation without a network request", () => {
  const [player] = planPlayerEnrichment([
    candidate({ opportunityHistory: [] }),
  ], now);
  assert.equal(player.needsOpportunity, true);
  assert.equal(player.estimatedRequests, 0);
  assert.equal(selectWithinRequestBudget([player], 0).selected.length, 1);
});

test("UZ1 candidates are prioritized and request budget counts calls rather than players", () => {
  const plan = planPlayerEnrichment([
    candidate({ id: "other", tmPlayerId: "2", portraitUrl: null }),
    candidate({ id: "uz1", tmPlayerId: "3", performances: [], club: { competition: { tmCompetitionId: "UZ1" } } }),
  ], now);
  assert.equal(plan[0].id, "uz1");
  const selected = selectWithinRequestBudget(plan, 1);
  assert.deepEqual(selected.selected.map((player) => player.id), ["uz1"]);
  assert.equal(selected.estimatedRequests, 1);
});

test("max players and request budget are both respected without any provider work", () => {
  const plan = planPlayerEnrichment([
    candidate({ id: "one", tmPlayerId: "2", portraitUrl: null }),
    candidate({ id: "two", tmPlayerId: "3", performances: [] }),
  ], now);
  assert.equal(selectWithinRequestBudget(plan, 10, 1).selected.length, 1);
  assert.equal(selectWithinRequestBudget(plan, 1).selected.length, 1);
});
