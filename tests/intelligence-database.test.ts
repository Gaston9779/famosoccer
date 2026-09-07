import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "famosoccer-intelligence-"));
process.env.DATABASE_URL = `file:${dir}/test.db`;
writeFileSync(`${dir}/test.db`, "");
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { env: process.env, stdio: "pipe" },
);
const { db } = await import("../src/lib/db");
const {
  recalculateAllScores,
  recalculateAllClubNeeds,
  calculateAndPersistPlayerOpportunity,
} = await import("../src/lib/intelligence/persistence");
const { generateSnapshotEvents } = await import(
  "../src/lib/intelligence/events"
);
const {
  loadIntelligenceView,
  filterPlayerOpportunities,
  filterClubNeeds,
  topMatches,
  dashboardSummary,
  listEvents,
} = await import("../src/lib/intelligence/queries");
const now = new Date("2026-09-06T12:00:00Z");
after(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
test("score persistence, history threshold, events and read-only queries", async () => {
  const comp = await db.competition.create({
    data: {
      tmCompetitionId: "UZ1",
      name: "Uzbekistan",
      country: "Uzbekistan",
      season: "2026",
    },
  });
  await db.club.createMany({
    data: [
      {
        id: "a",
        tmClubId: "1",
        name: "Club A",
        competitionId: comp.id,
        lastSyncedAt: now,
      },
      {
        id: "b",
        tmClubId: "2",
        name: "Club B",
        competitionId: comp.id,
        lastSyncedAt: now,
      },
    ],
  });
  const player = await db.player.create({
    data: {
      id: "player",
      tmPlayerId: "123",
      name: "Local test player",
      tmUrl: "https://www.transfermarkt.com/test/profil/spieler/123",
      clubId: "a",
      mainPosition: "Right-Back",
      age: 24,
      contractExpires: new Date("2026-10-01"),
      representationStatus: "NO_AGENT",
      marketValueEur: 200000,
      profileLastSyncedAt: now,
    },
  });
  await db.player.create({
    data: {
      tmPlayerId: "124",
      name: "Other player",
      tmUrl: "https://www.transfermarkt.com/test/profil/spieler/124",
      clubId: "b",
      mainPosition: "Right-Back",
      age: 31,
    },
  });
  await db.playerSnapshot.create({
    data: {
      playerId: player.id,
      representationStatus: "NO_AGENT",
      clubId: "a",
      capturedAt: new Date("2026-09-01"),
    },
  });
  await db.playerSnapshot.create({
    data: {
      playerId: player.id,
      representationStatus: "AGENCY",
      agencyName: "Team Anchor",
      clubId: "a",
      capturedAt: new Date("2026-09-02"),
    },
  });
  const result = await recalculateAllScores(now);
  assert.equal(result.players.length, 2);
  assert.equal(result.clubHistoryRowsWritten, 20);
  assert.equal(await db.playerEvent.count(), 2);
  await generateSnapshotEvents();
  assert.equal(await db.playerEvent.count(), 2);
  const again = await recalculateAllClubNeeds(now);
  assert.equal(again.filter((r) => r.written).length, 0);
  const view = await loadIntelligenceView();
  assert.equal(filterPlayerOpportunities(view, { role: "RB" }).total, 2);
  assert.equal(filterPlayerOpportunities(view, { minScore: 100 }).total, 0);
  assert.equal(filterClubNeeds(view, { club: "b", role: "RB" }).total, 1);
  const matches = topMatches(view, { playerId: "player", limit: 1 }, now);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].clubId, "b");
  const before = await db.clubNeedHistory.count();
  await dashboardSummary();
  await dashboardSummary();
  assert.equal(await db.clubNeedHistory.count(), before);
  await db.player.update({
    where: { id: "player" },
    data: { representationStatus: "AGENCY" },
  });
  await calculateAndPersistPlayerOpportunity("player", now);
  assert.equal(
    await db.playerEvent.count({
      where: { type: "OPPORTUNITY_SCORE_DECREASED" },
    }),
    1,
  );
  assert.equal(
    await db.playerOpportunityHistory.count({
      where: { playerId: "player", isCurrent: true },
    }),
    1,
  );
  await db.player.update({
    where: { id: "player" },
    data: { mainPosition: "Left-Back" },
  });
  assert.ok((await recalculateAllClubNeeds(now)).some((r) => r.written));
  assert.ok(
    (await listEvents({ unread: true, type: "AGENCY_CHANGED" })).length === 1,
  );
});
test("note and tag API contracts: validation, idempotent assignment, removal and 404", async () => {
  const notes = await import("../src/app/api/players/[id]/notes/route");
  const tags = await import("../src/app/api/players/[id]/tags/route");
  const ctx = { params: Promise.resolve({ id: "player" }) };
  const req = (url: string, data: unknown) =>
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  assert.equal(
    (
      await notes.POST(
        req("/notes", { content: "  Local scouting note  " }),
        ctx,
      )
    ).status,
    201,
  );
  const read = await notes.GET(new Request("http://localhost/notes"), ctx);
  assert.equal((await read.json()).items[0].content, "Local scouting note");
  assert.equal(
    (await notes.POST(req("/notes", { content: " " }), ctx)).status,
    400,
  );
  assert.equal(
    (
      await notes.GET(new Request("http://localhost/notes"), {
        params: Promise.resolve({ id: "missing" }),
      })
    ).status,
    404,
  );
  await tags.POST(req("/tags", { name: "Watch", color: "#11aa22" }), ctx);
  await tags.POST(req("/tags", { name: "Watch" }), ctx);
  assert.equal(await db.playerTagAssignment.count(), 1);
  const tag = await db.playerTag.findFirstOrThrow();
  assert.equal(
    (
      await tags.DELETE(
        new Request(`http://localhost/tags?tagId=${tag.id}`, {
          method: "DELETE",
        }),
        ctx,
      )
    ).status,
    200,
  );
  assert.equal(await db.playerTagAssignment.count(), 0);
});
test("Zod rejects invalid filters and parses false literally", async () => {
  const { playerFilters, eventFilters, matchFilters } = await import(
    "../src/lib/intelligence/api"
  );
  assert.equal(playerFilters.safeParse({ minScore: 101 }).success, false);
  assert.equal(playerFilters.safeParse({ role: "FB" }).success, false);
  assert.equal(eventFilters.parse({ unread: "false" }).unread, false);
  assert.equal(matchFilters.safeParse({ limit: 9999 }).success, false);
});
