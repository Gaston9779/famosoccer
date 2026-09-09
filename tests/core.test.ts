import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { playerUrl } from "../src/lib/transfermarkt/endpoints";
import {
  normalizePosition,
  normalizeRepresentation,
  parseDate,
  marketValue,
} from "../src/lib/normalization";
import { parseProfile } from "../src/lib/transfermarkt/parsers/profile";
import {
  parsePerformance,
  currentLeaguePerformance,
} from "../src/lib/transfermarkt/parsers/performance";
import { parseListings } from "../src/lib/transfermarkt/parsers/listings";
import { scoringInputs, shouldFetchPerformance } from "../src/lib/scoring";
import { RateLimiter } from "../src/lib/transfermarkt/rateLimiter";
import { scorePlayingTimeOpportunity } from "../src/lib/scoring/playerOpportunity";
import { numericRangeIncludes } from "../src/lib/player-filters";
test("empty numeric ranges keep players with unknown optional values visible", () => {
  assert.equal(numericRangeIncludes(null, "", ""), true);
  assert.equal(numericRangeIncludes(null, "20", ""), false);
  assert.equal(numericRangeIncludes(null, "", "80"), false);
  assert.equal(numericRangeIncludes(50, "20", "80"), true);
});
test("playing time rewards greater participation at canonical boundaries", () => {
  for (const [pct, score] of [[null,null],[0,0],[9.99,0],[10,3],[24.99,3],[25,8],[41.111,8],[49.99,8],[50,12],[64.5,12],[74.99,12],[75,15],[83.44,15],[100,15]] as const)
    assert.equal(scorePlayingTimeOpportunity(pct).score, score);
});
const fixture = (name: string) =>
  readFileSync(`tests/fixtures/transfermarkt/${name}`, "utf8");
test("player IDs across country domains; rejects lookalikes and unrelated paths", () => {
  for (const domain of ["com", "it", "de", "co.uk", "com.br"])
    assert.equal(
      playerUrl(
        `https://www.transfermarkt.${domain}/test/profil/spieler/123?x=1`,
      ).id,
      "123",
    );
  for (const url of [
    "https://transfermarkt.com.evil.test/a/profil/spieler/123",
    "https://eviltransfermarkt.com/a/profil/spieler/123",
    "https://transfermarkt.com/a/leistungsdaten/spieler/123",
    "https://transfermarkt.com@evil.test/a/profil/spieler/123",
    "https://transfermarkt.com/a/profil/spieler/0",
    "ftp://transfermarkt.com/a/profil/spieler/123",
  ])
    assert.throws(() => playerUrl(url));
});
test("positions preserve macro semantics", () => {
  for (const [raw, group] of [
    ["Goalkeeper", "GK"],
    ["Centre-Back", "CB"],
    ["Left-Back", "FB"],
    ["Defensive Midfield", "DM"],
    ["Central Midfield", "CM"],
    ["Attacking Midfield", "AM"],
    ["Right Winger", "WINGER"],
    ["Centre-Forward", "ST"],
    ["Alien", "UNKNOWN"],
  ])
    assert.equal(normalizePosition(raw), group);
  assert.equal(normalizePosition(null, 2), "UNKNOWN");
});
test("representation absent vs unknown vs explicit agency", () => {
  for (const [raw, status] of [
    [null, "NOT_LISTED"],
    ["", "UNKNOWN"],
    ["-", "UNKNOWN"],
    ["No agent", "NO_AGENT"],
    ["Without Club/Agent", "NO_AGENT"],
    ["Relatives", "FAMILY"],
    ["Family", "FAMILY"],
    ["Familie", "FAMILY"],
    ["Famiglia", "FAMILY"],
    ["Example Agency", "AGENCY"],
  ] as const)
    assert.equal(normalizeRepresentation(raw).representationStatus, status);
  assert.equal(
    normalizeRepresentation("Example Agency").agencyName,
    "Example Agency",
  );
});
test("conservative dates and EUR values", () => {
  assert.equal(parseDate("Feb 30, 2026"), null);
  assert.equal(parseDate("2026"), null);
  assert.equal(
    parseDate("31.12.2026")?.toISOString(),
    "2026-12-31T00:00:00.000Z",
  );
  assert.equal(marketValue("€1.25m"), 1250000);
  assert.equal(marketValue("$100k"), null);
});
test("profile semantic fields, missing agent, unavailable values", () => {
  const html = fixture("profile.synthetic.html");
  const p = parseProfile(
    html,
    "123",
    "https://www.transfermarkt.com/test-player/profil/spieler/123",
  );
  assert.equal(p.name, "Test Player");
  assert.equal(p.contractExpires?.getUTCFullYear(), 2026);
  assert.equal(p.representationStatus, "FAMILY");
  assert.equal(p.marketValueEur, 350000);
  assert.equal(p.heightCm, 185);
  assert.deepEqual(JSON.parse(p.nationalities), ["Uzbekistan", "Russia"]);
  assert.equal(
    parseProfile(html.replace("Player agent:", "Unrelated:"), "123", p.tmUrl)
      .representationStatus,
    "NOT_LISTED",
  );
  assert.throws(() => parseProfile("<h1>Access denied</h1>", "123", p.tmUrl));
});
test("tolerant listing schema and performance selector use UZ1 and season", () => {
  assert.equal(
    parseListings('[{"id":123,"name":"Example","newField":true}]')[0].id,
    "123",
  );
  assert.throws(() => parseListings('{"unexpected":true}'));
  const rows = parsePerformance(fixture("performance.synthetic.json"));
  assert.equal(
    currentLeaguePerformance(rows, new Date("2026-09-01"))?.season,
    "2025",
  );
  assert.equal(rows[0].minutesPlayed, 1234);
  assert.equal(rows[2].minutesPlayed, 1134);
  assert.equal(
    currentLeaguePerformance(rows.filter((r) => r.competitionCode !== "UZ1")),
    null,
  );
});
test("scoring readiness and missing values remain unknown", () => {
  const player = {
    representationStatus: "NOT_LISTED" as const,
    contractExpires: null,
    performances: [],
  };
  assert.equal(scoringInputs(player).commercialStatus, "UNKNOWN");
  assert.equal(scoringInputs(player).playingTimeBand, "UNKNOWN");
  assert.equal(shouldFetchPerformance(player), true);
  const template = parsePerformance(fixture("performance.synthetic.json"))[0];
  for (const [pct, band] of [
    [0, "MARGINAL"],
    [10, "LOW"],
    [25, "ROTATION"],
    [50, "HIGH"],
    [75, "STARTER"],
  ] as const)
    assert.equal(
      scoringInputs({
        ...player,
        performances: [{ ...template, minutesPlayedPercent: pct }],
      }).playingTimeBand,
      band,
    );
  assert.equal(
    shouldFetchPerformance({
      representationStatus: "AGENCY",
      contractExpires: null,
    }),
    false,
  );
});
test("rate limiter guarantees one concurrent operation", async () => {
  const limiter = new RateLimiter(0, 0);
  let active = 0;
  let max = 0;
  await Promise.all(
    Array.from({ length: 5 }, () =>
      limiter.schedule(async () => {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
      }),
    ),
  );
  assert.equal(max, 1);
});
test(
  "live fixtures are parsed when a successful probe captured them",
  { skip: !existsSync("tests/fixtures/transfermarkt/profile.live.html") },
  () => {
    const meta = JSON.parse(fixture("profile.live.meta.json"));
    const p = parseProfile(fixture("profile.live.html"), meta.id, meta.url);
    assert.ok(p.name);
    assert.equal(p.birthDate?.toISOString().slice(0, 10), "1998-05-20");
    assert.equal(p.contractExpires?.toISOString().slice(0, 10), "2027-12-31");
    assert.equal(p.positionGroup, "FB");
    assert.deepEqual(JSON.parse(p.secondaryPositions!), [
      "Right Midfield",
      "Left-Back",
    ]);
    if (existsSync("tests/fixtures/transfermarkt/performance.live.json"))
      assert.ok(
        Array.isArray(parsePerformance(fixture("performance.live.json"))),
      );
  },
);
