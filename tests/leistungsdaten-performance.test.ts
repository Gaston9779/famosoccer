import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performanceUrl, tmapiPerformanceUrl } from "../src/lib/transfermarkt/endpoints";
import { parsePerformance } from "../src/lib/transfermarkt/parsers/performance";

test("derives Leistungsdaten from the persisted canonical profile URL", () => {
  assert.deepEqual(
    performanceUrl("https://www.transfermarkt.com/sarvar-abdukhamidov/profil/spieler/1177021"),
    { id: "1177021", path: "/sarvar-abdukhamidov/leistungsdaten/spieler/1177021", url: "https://www.transfermarkt.com/sarvar-abdukhamidov/leistungsdaten/spieler/1177021" },
  );
});

test("uses the TMAPI request proven by the public performance component", () => {
  assert.deepEqual(tmapiPerformanceUrl("1177021"), {
    path: "/player/1177021/performance-game",
    url: "https://tmapi.transfermarkt.technology/player/1177021/performance-game",
  });
  assert.throws(() => tmapiPerformanceUrl("seed:UZ1-1"), { code: "INVALID_URL" });
});

test("real Sarvar Leistungsdaten HTML is rejected when it only contains client-rendered proxies", () => {
  const html = readFileSync("tests/fixtures/transfermarkt/performance.leistungsdaten.live.html", "utf8");
  assert.match(html, /player-id="1177021"/);
  assert.match(html, /performanceByCompetitions/);
  assert.throws(() => parsePerformance(html), { code: "SCHEMA" });
});

test("aggregates the actual TMAPI game structure by visible season and competition ID", () => {
  const rows = parsePerformance(readFileSync("tests/fixtures/transfermarkt/performance.tmapi.sarvar.json", "utf8"));
  const uz1 = rows.find((row) => row.season === "2026" && row.competitionKey === "UZ1");
  const cup = rows.find((row) => row.competitionKey === "KOBU");
  assert.deepEqual(uz1, {
    season: "2026", competitionName: "Superliga", competitionCode: "UZ1", competitionKey: "UZ1",
    possibleGames: 2, gamesPlayed: 1, goals: 1, assists: 1, yellowCards: 1,
    secondYellowCards: null, redCards: null, startElevenPercent: 50, minutesPlayedPercent: 25, minutesPlayed: 45,
  });
  assert.equal(cup?.season, "2026");
  assert.equal(cup?.competitionKey, "KOBU");
  assert.equal(rows.filter((row) => row.competitionKey === "UZ1").length, 1);
});
