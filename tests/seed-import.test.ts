import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createPostgresTestDatabase } from "./helpers/postgres";

const testDatabase = await createPostgresTestDatabase();
process.env.DATABASE_URL = testDatabase.connectionString;
process.env.DATABASE_SCHEMA = testDatabase.schema;

const { db } = await import("../src/lib/db");
const { importUzbekistanSeed } = await import(
  "../src/lib/services/uzbekistanSeed"
);

after(async () => {
  await db.$disconnect();
  await testDatabase.cleanup();
});

const seed = {
  meta: { competitionCode: "UZ1" as const, asOf: "2026-09-07" },
  clubs: [
    {
      name: "AGMK",
      competitionCode: "UZ1" as const,
      sourceUrl: "https://seed.example/agmk",
    },
  ],
  players: [
    {
      seedKey: "UZ1-2026-AGMK-001",
      name: "Known Player",
      clubName: "AGMK",
      competitionCode: "UZ1" as const,
      season: 2026,
      sourcePositionGroup: "DF" as const,
      mainRole: "RB" as const,
      exactRoleVerified: true,
      birthDate: null,
      nationalities: [],
      contractExpires: null,
      confirmedFreeAgent: false,
      representationStatus: "UNKNOWN" as const,
      agencyName: null,
      marketValueEur: null,
      tmPlayerId: null,
      tmUrl: null,
      performance: null,
      importEligible: true,
    },
    {
      seedKey: "UZ1-2026-AGMK-002",
      name: "Seed Player",
      clubName: "AGMK",
      competitionCode: "UZ1" as const,
      season: 2026,
      sourcePositionGroup: "MF" as const,
      mainRole: "UNKNOWN" as const,
      exactRoleVerified: false,
      birthDate: "2000-02-03",
      nationalities: ["Uzbekistan"],
      contractExpires: "2026-12-31",
      confirmedFreeAgent: false,
      representationStatus: "UNKNOWN" as const,
      agencyName: null,
      marketValueEur: 200000,
      tmPlayerId: null,
      tmUrl: null,
      performance: {
        season: "2026",
        competitionName: "Superliga",
        competitionCode: "UZ1",
        minutesPlayedPercent: 25,
        minutesPlayed: 500,
      },
      importEligible: true,
    },
  ],
};

test("seed aliases clubs, preserves known existing values, and is idempotent", async () => {
  const competition = await db.competition.create({
    data: {
      tmCompetitionId: "UZ1",
      name: "Uzbekistan Super League",
      country: "Uzbekistan",
      season: "2026",
    },
  });
  const agmk = await db.club.create({
    data: {
      tmClubId: "31216",
      name: "FC OKMK Olmaliq",
      competitionId: competition.id,
    },
  });
  await db.player.create({
    data: {
      tmPlayerId: "123",
      tmUrl: "https://www.transfermarkt.com/known/profil/spieler/123",
      name: "Known Player",
      clubId: agmk.id,
      mainPosition: "Centre-Back",
      positionGroup: "CB",
      birthDate: new Date("1990-01-01T00:00:00Z"),
      nationalities: '["Uzbekistan"]',
      contractExpires: new Date("2028-12-31T00:00:00Z"),
      representationStatus: "AGENCY",
      agencyName: "Known Agency",
      marketValueEur: 900000,
      confirmedFreeAgent: true,
    },
  });

  const first = await importUzbekistanSeed(seed);
  assert.deepEqual(
    {
      clubsBefore: first.clubsBefore,
      clubsAfter: first.clubsAfter,
      newPlayersInserted: first.newPlayersInserted,
      existingPlayersUpdated: first.existingPlayersUpdated,
      duplicatesPrevented: first.duplicatesPrevented,
      failures: first.importFailures.length,
    },
    { clubsBefore: 1, clubsAfter: 1, newPlayersInserted: 1, existingPlayersUpdated: 0, duplicatesPrevented: 1, failures: 0 },
  );
  assert.equal(await db.club.count(), 1);
  assert.equal(await db.player.count(), 2);
  const known = await db.player.findUniqueOrThrow({ where: { tmPlayerId: "123" } });
  assert.equal(known.mainPosition, "Centre-Back");
  assert.equal(known.representationStatus, "AGENCY");
  assert.equal(known.confirmedFreeAgent, true);
  assert.equal(known.marketValueEur, 900000);
  const created = await db.player.findUniqueOrThrow({
    where: { tmPlayerId: "seed:UZ1-2026-AGMK-002" },
    include: { performances: true },
  });
  assert.equal(created.mainPosition, "UNKNOWN");
  assert.equal(created.positionGroup, "MF");
  assert.equal(created.tmUrl, "seed://uz1/UZ1-2026-AGMK-002");
  assert.equal(created.performances[0].minutesPlayed, 500);
  assert.equal(created.performances[0].minutesPlayedPercent, 25);
  assert.equal((await db.club.findUniqueOrThrow({ where: { id: agmk.id } })).lastSyncedAt?.toISOString().slice(0, 10), "2026-09-07");

  const second = await importUzbekistanSeed(seed);
  assert.equal(second.newPlayersInserted, 0);
  assert.equal(second.existingPlayersUpdated, 0);
  assert.equal(second.duplicatesPrevented, 2);
  assert.equal(await db.player.count(), 2);
  assert.equal(await db.playerSnapshot.count(), 1);
});

test("unverified roles remain UNKNOWN even when a public group labels them ST", async () => {
  const source = {
    ...seed,
    clubs: [
      {
        name: "AGMK",
        competitionCode: "UZ1" as const,
        sourceUrl: "https://seed.example/agmk",
      },
    ],
    players: [
      {
        ...seed.players[0],
        seedKey: "UZ1-2026-AGMK-UNVERIFIED-ST",
        name: "Unverified Forward",
        sourcePositionGroup: "FW" as const,
        mainRole: "ST" as const,
        exactRoleVerified: false,
      },
    ],
  };
  await importUzbekistanSeed(source);
  assert.equal(
    (
      await db.player.findUniqueOrThrow({
        where: { tmPlayerId: "seed:UZ1-2026-AGMK-UNVERIFIED-ST" },
      })
    ).mainPosition,
    "UNKNOWN",
  );
});

test("club punctuation aliases do not create a second Mash'al record", async () => {
  const existing = await db.club.create({
    data: { tmClubId: "13649", name: "Mash'al Mubarek" },
  });
  const mashalSeed = {
    ...seed,
    clubs: [
      {
      name: "Mashal Muborak",
        competitionCode: "UZ1" as const,
        sourceUrl: "https://seed.example/mashal",
      },
    ],
    players: [],
  };
  await importUzbekistanSeed(mashalSeed);
  assert.equal(await db.club.count({ where: { tmClubId: "13649" } }), 1);
  assert.equal((await db.club.findUniqueOrThrow({ where: { id: existing.id } })).lastSyncedAt?.toISOString().slice(0, 10), "2026-09-07");
});
