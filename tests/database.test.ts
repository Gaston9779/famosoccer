import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPostgresTestDatabase } from "./helpers/postgres";

const testDatabase = await createPostgresTestDatabase();
process.env.DATABASE_URL = testDatabase.connectionString;
process.env.DATABASE_SCHEMA = testDatabase.schema;
process.env.TM_REQUEST_DELAY_MS = "0";
process.env.TM_REQUEST_JITTER_MS = "0";
const { db } = await import("../src/lib/db");
const { saveProfile, importPlayerFromTransfermarktUrl, playerScopeWhere, emptyCounts } = await import("../src/lib/services/players");
const { parseProfile } = await import(
  "../src/lib/transfermarkt/parsers/profile"
);
const { TransfermarktClient } = await import("../src/lib/transfermarkt/client");
after(async () => {
  await db.$disconnect();
  await testDatabase.cleanup();
});
test("upsert unique ID and snapshots only on tracked changes", async () => {
  const p = parseProfile(
    readFileSync("tests/fixtures/transfermarkt/profile.synthetic.html", "utf8"),
    "123",
    "https://www.transfermarkt.com/test-player/profil/spieler/123",
  );
  await saveProfile(p);
  await saveProfile(p);
  assert.equal(await db.player.count(), 1);
  assert.equal(await db.playerSnapshot.count(), 1);
  await saveProfile({ ...p, marketValueEur: 400000 });
  assert.equal(await db.player.count(), 1);
  assert.equal(await db.playerSnapshot.count(), 2);
  await assert.rejects(
    db.player.create({
      data: { tmPlayerId: "123", name: "Duplicate", tmUrl: p.tmUrl },
    }),
  );
});
test("request budget counts retries and persists attempted totals", async () => {
  const run = await db.syncRun.create({ data: { type: "TEST" } });
  let calls = 0;
  const client = new TransfermarktClient(run.id, 1, async () => {
    calls++;
    return new Response("[]");
  });
  await client.request("/one");
  await client.request("/one");
  await assert.rejects(client.request("/two"), { code: "BUDGET_EXHAUSTED" });
  assert.equal(calls, 1);
  assert.equal(
    (await db.syncRun.findUniqueOrThrow({ where: { id: run.id } }))
      .requestsAttempted,
    1,
  );
});
test("403 and 429 persist BLOCKED immediately and never retry", async () => {
  for (const status of [403, 429]) {
    const run = await db.syncRun.create({ data: { type: "TEST" } });
    let calls = 0;
    const client = new TransfermarktClient(run.id, 10, async () => {
      calls++;
      return new Response("blocked", { status });
    });
    await assert.rejects(client.request("/one"), { code: "BLOCKED" });
    await assert.rejects(client.request("/two"));
    const saved = await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "BLOCKED");
    assert.equal(saved.requestsFailed, 1);
    assert.equal(calls, 1);
  }
});
test("503 delays then opens circuit after three failures", async () => {
  const run = await db.syncRun.create({ data: { type: "TEST" } });
  const waits: number[] = [];
  const client = new TransfermarktClient(
    run.id,
    10,
    async () => new Response("unavailable", { status: 503 }),
    async (ms) => {
      waits.push(ms);
    },
  );
  await assert.rejects(client.request("/one"), { code: "CIRCUIT_OPEN" });
  assert.deepEqual(waits, [30000, 90000]);
  assert.equal(
    (await db.syncRun.findUniqueOrThrow({ where: { id: run.id } }))
      .http503Count,
    3,
  );
});
test("noRetries option: one attempt, no back-off wait, no retry loop on 503/500", async () => {
  for (const status of [503, 500]) {
    const run = await db.syncRun.create({ data: { type: "TEST" } });
    let calls = 0;
    const waits: number[] = [];
    const client = new TransfermarktClient(
      run.id,
      10,
      async () => { calls++; return new Response("x", { status }); },
      async (ms) => { waits.push(ms); },
      { noRetries: true },
    );
    await assert.rejects(client.request("/one"), { code: "HTTP", status });
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  }
});
test("bootstrap budget cursor resumes without duplicating players; manual import updates", async () => {
  const { bootstrapUzbekistanSuperLeague } = await import(
    "../src/lib/services/sync"
  );
  await db.syncRun.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED" },
  });
  await db.syncRun.create({
    data: { type: "PROBE", status: "SUCCESS", finishedAt: new Date() },
  });
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === "/quickselect/teams/UZ1")
      return new Response('[{"id":"456","name":"Test Club"}]');
    if (path === "/quickselect/players/456")
      return new Response(
        '[{"id":"123","name":"Test Player","link":"/test-player/profil/spieler/123"}]',
      );
    if (path.includes("/profil/spieler/123"))
      return new Response(
        readFileSync(
          "tests/fixtures/transfermarkt/profile.synthetic.html",
          "utf8",
        ),
      );
    if (path.includes("/performance-game"))
      return new Response(
        readFileSync(
          "tests/fixtures/transfermarkt/performance.synthetic.json",
          "utf8",
        ),
      );
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    process.env.TM_BOOTSTRAP_MAX_REQUESTS = "2";
    const first = await bootstrapUzbekistanSuperLeague();
    assert.equal(first.status, "PARTIAL");
    assert.equal(first.requestsAttempted, 2);
    assert.equal(JSON.parse(first.metadata!).state.phase, "profiles");
    process.env.TM_BOOTSTRAP_MAX_REQUESTS = "10";
    const second = await bootstrapUzbekistanSuperLeague();
    assert.equal(second.status, "SUCCESS");
    assert.equal(second.requestsAttempted, 2);
    assert.equal(paths.filter((p) => p === "/quickselect/teams/UZ1").length, 1);
    assert.equal(await db.player.count(), 1);
    const imported = await importPlayerFromTransfermarktUrl(
      "https://www.transfermarkt.it/test-player/profil/spieler/123",
    );
    assert.equal(imported.status, "UPDATED");
    assert.equal(imported.player.tmPlayerId, "123");
    assert.equal(imported.player.manuallyAdded, true);
    assert.equal(await db.player.count(), 1);
    assert.equal(imported.player.currentLeaguePerformance?.season, "2025");
  } finally {
    globalThis.fetch = original;
  }
});

test("manual import creates once, then updates the same player when performance returns HTTP 404", async () => {
  const original = globalThis.fetch;
  let profile = readFileSync("tests/fixtures/transfermarkt/profile.synthetic.html", "utf8").replaceAll("spieler/123", "spieler/321");
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/profil/spieler/321")) return new Response(profile);
    if (path === "/player/321/performance-game") return new Response(null, { status: 404 });
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    const countBefore = await db.player.count();
    const imported = await importPlayerFromTransfermarktUrl(
      "https://www.transfermarkt.com/test-player/profil/spieler/321",
    );
    assert.equal(imported.status, "PARTIAL");
    assert.equal(imported.operation, "IMPORTED");
    assert.equal(imported.player.tmPlayerId, "321");
    assert.equal(imported.player.opportunityHistory.length, 1);
    assert.equal(imported.warning, "Performance data is currently unavailable.");
    assert.equal((await db.player.findUniqueOrThrow({ where: { tmPlayerId: "321" } })).manuallyAdded, true);
    const run = await db.syncRun.findFirstOrThrow({ where: { type: "MANUAL" }, orderBy: { startedAt: "desc" } });
    assert.equal(run.status, "PARTIAL");
    assert.equal(run.message, "Performance data unavailable (HTTP 404).");
    assert.equal(await db.player.count(), countBefore + 1);

    profile = profile.replace("€350k", "€550k");
    const updated = await importPlayerFromTransfermarktUrl(
      "https://www.transfermarkt.com/test-player/profil/spieler/321",
    );
    assert.equal(updated.status, "PARTIAL");
    assert.equal(updated.operation, "UPDATED");
    assert.equal(updated.player.tmPlayerId, "321");
    assert.equal(await db.player.count(), countBefore + 1);
    assert.equal((await db.player.findUniqueOrThrow({ where: { tmPlayerId: "321" } })).marketValueEur, 550000);
  } finally {
    globalThis.fetch = original;
  }
});

test("manual profile refresh follows the profile club and supports a free agent", async () => {
  const p = parseProfile(
    readFileSync("tests/fixtures/transfermarkt/profile.synthetic.html", "utf8").replaceAll("spieler/123", "spieler/7771"),
    "7771",
    "https://www.transfermarkt.com/manual-scope-player/profil/spieler/7771",
  );
  const { currentClub: _currentClub, ...profileData } = p;
  const foreignClub = await db.club.create({ data: { tmClubId: "manual-scope-club", name: "Manual foreign club" } });
  await db.player.create({ data: { ...profileData, tmPlayerId: "7771", tmUrl: "https://www.transfermarkt.com/manual-scope-player/profil/spieler/7771", clubId: foreignClub.id } });
  await saveProfile({ ...p, tmPlayerId: "7771", tmUrl: "https://www.transfermarkt.com/manual-scope-player/profil/spieler/7771", currentClub: null }, emptyCounts(), true);
  const player = await db.player.findUniqueOrThrow({ where: { tmPlayerId: "7771" } });
  assert.equal(player.clubId, null);
  assert.ok((await db.player.findMany({ where: playerScopeWhere("OTHER"), select: { id: true } })).some((row) => row.id === player.id));
});

test("import route returns HTTP 200 with PARTIAL when profile import succeeds", async () => {
  const { POST } = await import("../src/app/api/players/import/route");
  const original = globalThis.fetch;
  const profile = readFileSync("tests/fixtures/transfermarkt/profile.synthetic.html", "utf8").replaceAll("spieler/123", "spieler/324");
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/profil/spieler/324")) return new Response(profile);
    if (path === "/player/324/performance-game") return new Response(null, { status: 404 });
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    const response = await POST(new Request("http://localhost/api/players/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.transfermarkt.com/test-player/profil/spieler/324" }),
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.operation, "IMPORTED");
    assert.equal(result.player.tmPlayerId, "324");
    const updatedResponse = await POST(new Request("http://localhost/api/players/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.transfermarkt.com/test-player/profil/spieler/324" }),
    }));
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.status, "PARTIAL");
    assert.equal(updated.operation, "UPDATED");
  } finally {
    globalThis.fetch = original;
  }
});

test("one manual import = one profile request + one performance request; TM is the only source", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  const profile = readFileSync("tests/fixtures/transfermarkt/profile.synthetic.html", "utf8").replaceAll("spieler/123", "spieler/525");
  const performance = readFileSync("tests/fixtures/transfermarkt/performance.synthetic.json", "utf8");
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.ok(["https://www.transfermarkt.com", "https://tmapi.transfermarkt.technology"].includes(url.origin), "only Transfermarkt-owned origins are ever contacted");
    paths.push(url.pathname);
    if (url.pathname === "/test-player/profil/spieler/525") return new Response(profile);
    if (url.pathname === "/player/525/performance-game") return new Response(performance);
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  try {
    const result = await importPlayerFromTransfermarktUrl("https://www.transfermarkt.com/test-player/profil/spieler/525");
    assert.equal(result.status, "IMPORTED");
    // exactly one profile + exactly one performance request, nothing else
    assert.deepEqual(paths.sort(), ["/player/525/performance-game", "/test-player/profil/spieler/525"]);
    assert.equal(paths.filter((p) => p.includes("/profil/spieler/")).length, 1);
    assert.equal(paths.filter((p) => p.includes("/performance-game")).length, 1);

    const rows = await db.playerPerformance.findMany({ where: { player: { tmPlayerId: "525" } }, orderBy: { season: "asc" } });
    // every returned competition/season persisted, keyed by season + competitionKey
    assert.deepEqual(rows.map((r) => `${r.season}/${r.competitionKey}`).sort(), ["2024/UZ1", "2025/UZ1", "2026/UZP"]);
    for (const row of rows) {
      assert.equal(row.provider, "TRANSFERMARKT");
      // extended stats Transfermarkt's summary does not provide stay null (never fabricated to 0)
      assert.equal(row.rating, null);
      assert.equal(row.shotsTotal, null);
      assert.equal(row.tacklesTotal, null);
      assert.equal(row.passesTotal, null);
      assert.equal(row.saves, null);
      assert.equal(row.lineups, null);
      assert.equal(row.captain, null);
    }
    const uz1_2025 = rows.find((r) => r.season === "2025" && r.competitionKey === "UZ1")!;
    assert.equal(uz1_2025.goals, 3);
    assert.equal(uz1_2025.assists, 2);
    assert.equal(uz1_2025.gamesPlayed, 18);
  } finally {
    globalThis.fetch = original;
  }
});

test("savePerformance keeps a stored stat when Transfermarkt omits it (null never overwrites a value)", async () => {
  const { savePerformance } = await import("../src/lib/services/players");
  const player = await db.player.create({ data: { tmPlayerId: "526", name: "Keep Player", tmUrl: "https://www.transfermarkt.com/keep/profil/spieler/526" } });
  await savePerformance(player.id, [{ season: "2026", competitionName: "Superliga", competitionCode: "UZ1", competitionKey: "UZ1", possibleGames: 20, gamesPlayed: 15, goals: 5, assists: 3, yellowCards: 2, secondYellowCards: 0, redCards: 0, startElevenPercent: 60, minutesPlayedPercent: 55, minutesPlayed: 1200 }]);
  // a later scrape returns the same competition with goals missing
  await savePerformance(player.id, [{ season: "2026", competitionName: "Superliga", competitionCode: "UZ1", competitionKey: "UZ1", possibleGames: 22, gamesPlayed: 17, goals: null, assists: 4, yellowCards: null, secondYellowCards: null, redCards: null, startElevenPercent: null, minutesPlayedPercent: 58, minutesPlayed: 1300 }]);
  const row = await db.playerPerformance.findFirstOrThrow({ where: { playerId: player.id, season: "2026", competitionKey: "UZ1" } });
  assert.equal(row.goals, 5, "goals retained from the earlier scrape");
  assert.equal(row.assists, 4, "assists updated");
  assert.equal(row.minutesPlayed, 1300);
  assert.equal(row.provider, "TRANSFERMARKT");
});

test("manual import does not silence a profile failure or a non-404 performance failure", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(
      importPlayerFromTransfermarktUrl("https://www.transfermarkt.com/test-player/profil/spieler/322"),
      { code: "HTTP" },
    );

    const profile = readFileSync("tests/fixtures/transfermarkt/profile.synthetic.html", "utf8").replaceAll("spieler/123", "spieler/323");
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/profil/spieler/323")) return new Response(profile);
      if (path === "/player/323/performance-game") return new Response("not-json");
      throw new Error(`Unexpected request ${path}`);
    };
    await assert.rejects(
      importPlayerFromTransfermarktUrl("https://www.transfermarkt.com/test-player/profil/spieler/323"),
      { code: "SCHEMA" },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("player scopes separate UZ1 membership from all other players", async () => {
  const uzbekistan = await db.competition.upsert({
    where: { tmCompetitionId: "UZ1" },
    create: { tmCompetitionId: "UZ1", name: "Uzbekistan Super League", country: "Uzbekistan", season: "2026" },
    update: {},
  });
  const foreignCompetition = await db.competition.create({ data: { tmCompetitionId: "FOREIGN_TEST", name: "Foreign League", country: "Test", season: "2026" } });
  const uzbekClub = await db.club.create({ data: { tmClubId: "scope-uz", name: "UZ club", competitionId: uzbekistan.id } });
  const foreignClub = await db.club.create({ data: { tmClubId: "scope-foreign", name: "Foreign club", competitionId: foreignCompetition.id } });
  const noCompetitionClub = await db.club.create({ data: { tmClubId: "scope-none", name: "Unassigned club" } });
  await db.player.createMany({ data: [
    { tmPlayerId: "scope-uz", name: "UZ player", tmUrl: "https://www.transfermarkt.com/uz/profil/spieler/9001", clubId: uzbekClub.id, careerStatus: "ACTIVE" },
    { tmPlayerId: "scope-foreign", name: "Foreign competition player", tmUrl: "https://www.transfermarkt.com/foreign/profil/spieler/9002", clubId: foreignClub.id },
    { tmPlayerId: "scope-none", name: "No competition player", tmUrl: "https://www.transfermarkt.com/none/profil/spieler/9003", clubId: noCompetitionClub.id },
    { tmPlayerId: "scope-free", name: "Free agent", tmUrl: "https://www.transfermarkt.com/free/profil/spieler/9004" },
  ] });
  const uzbek = await db.player.findMany({ where: playerScopeWhere("UZBEKISTAN"), select: { tmPlayerId: true } });
  const other = await db.player.findMany({ where: playerScopeWhere("OTHER"), select: { tmPlayerId: true } });
  assert.ok(uzbek.some((player) => player.tmPlayerId === "scope-uz"));
  assert.ok(!other.some((player) => player.tmPlayerId === "scope-uz"));
  for (const id of ["scope-foreign", "scope-none", "scope-free"])
    assert.ok(other.some((player) => player.tmPlayerId === id));
});

test('daily roster changes, selective TTL and shared daily request budget', async () => {
  const { refreshUzbekistanSuperLeague } = await import('../src/lib/services/sync');
  const club = await db.club.findUniqueOrThrow({ where: { tmClubId: '456' } });
  await db.player.create({data:{tmPlayerId:'124',name:'Departing Player',tmUrl:'https://www.transfermarkt.com/departing/profil/spieler/124',clubId:club.id}});
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async input => {
    calls++;
    const path = new URL(String(input)).pathname;
    if (path === '/quickselect/teams/UZ1') return new Response('[{"id":"456","name":"Test Club"},{"id":"789","name":"Second Club"}]');
    if (path === '/quickselect/players/456') return new Response('[{"id":"125","name":"New Player"}]');
    if (path === '/quickselect/players/789') return new Response('[{"id":"123","name":"Test Player"}]');
    throw new Error(`TTL/budget should prevent ${path}`);
  };
  process.env.TM_DAILY_MAX_REQUESTS = '3';
  try {
    const run = await refreshUzbekistanSuperLeague();
    assert.equal(run.status, 'PARTIAL');
    assert.equal(run.requestsAttempted, 3);
    const events = JSON.parse(run.metadata!).state.events;
    assert.ok(events.some((e:{type:string;player:string})=>e.type==='NEW_PLAYER'&&e.player==='125'));
    assert.ok(events.some((e:{type:string;player:string})=>e.type==='PLAYER_LEFT_ROSTER'&&e.player==='124'));
    assert.ok(events.some((e:{type:string;player:string})=>e.type==='PLAYER_CHANGED_CLUB'&&e.player==='123'));
    assert.equal((await db.player.findUniqueOrThrow({where:{tmPlayerId:'124'}})).clubId, null);
    const resumed = await refreshUzbekistanSuperLeague();
    assert.equal(resumed.status, 'PARTIAL');
    assert.equal(resumed.requestsAttempted, 0);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('HTTP blocks are persisted without reading a failed response body', async () => {
  const run = await db.syncRun.create({ data: { type: 'TEST' } });
  const response = new Response('blocked', { status: 403 });
  response.text = async () => { throw new Error('Must not consume blocked body'); };
  const client = new TransfermarktClient(run.id, 10, async () => response);
  await assert.rejects(client.request('/blocked-body'), { code: 'BLOCKED' });
  assert.equal((await db.syncRun.findUniqueOrThrow({where:{id:run.id}})).status,'BLOCKED');
});
