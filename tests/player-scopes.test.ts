import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPostgresTestDatabase } from "./helpers/postgres";

const testDatabase = await createPostgresTestDatabase();
process.env.DATABASE_URL = testDatabase.connectionString;
process.env.DATABASE_SCHEMA = testDatabase.schema;
const { db } = await import("../src/lib/db");
const { playerScopeFromQuery, playerScopeWhere } = await import(
  "../src/lib/services/players"
);

after(async () => {
  await db.$disconnect();
  await testDatabase.cleanup();
});

async function idsFor(scope: Parameters<typeof playerScopeWhere>[0]) {
  const rows = await db.player.findMany({
    where: playerScopeWhere(scope),
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

test("Serie A / Serie B are first-class scopes derived from current club competition, distinct from Other and from ITA/FRA pool membership", async () => {
  const [uz1, it1, it2] = await Promise.all([
    db.competition.create({ data: { tmCompetitionId: "UZ1", name: "Uzbekistan Super League", country: "Uzbekistan", season: "2026" } }),
    db.competition.create({ data: { tmCompetitionId: "IT1", name: "Serie A", country: "Italy", season: "2026/27" } }),
    db.competition.create({ data: { tmCompetitionId: "IT2", name: "Serie B", country: "Italy", season: "2026/27" } }),
  ]);
  const [uzClub, it1Club, it2Club] = await Promise.all([
    db.club.create({ data: { tmClubId: "u1", name: "UZ Club", competitionId: uz1.id } }),
    db.club.create({ data: { tmClubId: "s1", name: "Serie A Club", competitionId: it1.id } }),
    db.club.create({ data: { tmClubId: "s2", name: "Serie B Club", competitionId: it2.id } }),
  ]);

  const uzPlayer = await db.player.create({
    data: { tmPlayerId: "1001", name: "UZ Player", tmUrl: "https://www.transfermarkt.com/uz/profil/spieler/1001", clubId: uzClub.id, careerStatus: "ACTIVE" },
  });
  const it1Player = await db.player.create({
    data: { tmPlayerId: "1002", name: "Serie A Player", tmUrl: "https://www.transfermarkt.it/it1/profil/spieler/1002", clubId: it1Club.id, careerStatus: "ACTIVE" },
  });
  const it2Player = await db.player.create({
    data: { tmPlayerId: "1003", name: "Serie B Player", tmUrl: "https://www.transfermarkt.it/it2/profil/spieler/1003", clubId: it2Club.id, careerStatus: "ACTIVE" },
  });
  // A player with no club and no pool membership at all: this is the only kind
  // of player that should land in OTHER for this fixture.
  const genericOtherPlayer = await db.player.create({
    data: { tmPlayerId: "1004", name: "Generic Player", tmUrl: "https://www.transfermarkt.com/other/profil/spieler/1004", careerStatus: "UNKNOWN" },
  });
  // Dual membership: currently in the ITA scouting pool AND currently playing
  // at a Serie A club. Both must hold at once (Part 9: scope must not destroy
  // pool membership).
  const dualPlayer = await db.player.create({
    data: { tmPlayerId: "1005", name: "Dual Player", tmUrl: "https://www.transfermarkt.it/dual/profil/spieler/1005", clubId: it1Club.id, careerStatus: "ACTIVE" },
  });
  await db.playerPool.create({ data: { playerId: dualPlayer.id, poolKey: "ITA" } });

  // Query-param mapping.
  assert.equal(playerScopeFromQuery("it1"), "IT1");
  assert.equal(playerScopeFromQuery("IT1"), "IT1");
  assert.equal(playerScopeFromQuery("it2"), "IT2");
  assert.equal(playerScopeFromQuery(undefined), "UZBEKISTAN");

  const [it1Ids, it2Ids, otherIds, itaIds] = await Promise.all([
    idsFor("IT1"),
    idsFor("IT2"),
    idsFor("OTHER"),
    idsFor("ITA"),
  ]);

  // IT1 player -> appears in Serie A, does not appear in Other.
  assert.ok(it1Ids.has(it1Player.id));
  assert.ok(!otherIds.has(it1Player.id));

  // IT2 player -> appears in Serie B, does not appear in Other.
  assert.ok(it2Ids.has(it2Player.id));
  assert.ok(!otherIds.has(it2Player.id));

  // Serie A must not leak Serie B players and vice versa.
  assert.ok(!it1Ids.has(it2Player.id));
  assert.ok(!it2Ids.has(it1Player.id));

  // UZ1 players are never pulled into Serie A/B.
  assert.ok(!it1Ids.has(uzPlayer.id));
  assert.ok(!it2Ids.has(uzPlayer.id));

  // Other still holds the genuinely uncategorized player.
  assert.ok(otherIds.has(genericOtherPlayer.id));

  // Dual membership: in the ITA pool *and* currently in Serie A at the same time.
  assert.ok(itaIds.has(dualPlayer.id));
  assert.ok(it1Ids.has(dualPlayer.id));
  assert.ok(!otherIds.has(dualPlayer.id));

  // No IT1/IT2 PlayerPool rows were created for this: Serie A/B membership is
  // derived purely from current club competition, not a pool.
  const poolKeys = await db.playerPool.findMany({ select: { poolKey: true } });
  assert.ok(poolKeys.every((row) => row.poolKey !== "IT1" && row.poolKey !== "IT2"));
});
