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
const { saveProfile } = await import("../src/lib/services/players");
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
test("bootstrap budget cursor resumes without duplicating players; manual import updates", async () => {
  const { bootstrapUzbekistanSuperLeague } = await import(
    "../src/lib/services/sync"
  );
  const { importPlayerFromTransfermarktUrl } = await import(
    "../src/lib/services/players"
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
    if (path.includes("/performance"))
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
    assert.equal(imported.tmPlayerId, "123");
    assert.equal(imported.manuallyAdded, true);
    assert.equal(await db.player.count(), 1);
    assert.equal(imported.currentLeaguePerformance?.season, "2025");
  } finally {
    globalThis.fetch = original;
  }
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
