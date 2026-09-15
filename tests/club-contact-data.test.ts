import assert from "node:assert/strict";
import { test } from "node:test";
import database from "../src/data/club-intelligence/uzbekistan_football_prospect_database_2026.json";
import italyDatabase from "../src/data/club-intelligence/italy_club_intelligence_2026_27.json";
import { getClubContactData } from "../src/lib/intelligence/club-contact-data";

test("club intelligence uses exact Prisma Club IDs and keeps Super League IDs unique", () => {
  const superLeagueClubs = database.clubs.filter((club) => club.league === "Super League");
  const ids = superLeagueClubs.map((club) => club.club_id);

  assert.equal(superLeagueClubs.length, 16);
  assert.equal(new Set(ids).size, ids.length);

  const bunyodkor = superLeagueClubs.find((club) => club.club_name === "Bunyodkor");
  assert.ok(bunyodkor);
  assert.equal(
    getClubContactData({ id: bunyodkor.club_id, tmClubId: "irrelevant", competition: "UZ1" })?.club_name,
    "Bunyodkor",
  );
  assert.equal(getClubContactData({ id: "Bunyodkor", tmClubId: "irrelevant", competition: "UZ1" }), null);
  assert.equal(
    getClubContactData({ id: bunyodkor.club_id, tmClubId: "irrelevant", competition: "UZ1" })?.contacts.length,
    3,
  );
});

test("Italian club intelligence is keyed by tmClubId and scoped to IT1/IT2", () => {
  const inter = italyDatabase.clubs.find((club) => club.clubName === "Inter" && club.competitionKey === "IT1");
  assert.ok(inter);
  const data = getClubContactData({ id: "some-prisma-id", tmClubId: inter.tmClubId, competition: "IT1" });
  assert.equal(data?.club_name, "Inter");
  assert.equal(data?.contacts.length, inter.decisionMakers.length);
  // Wrong competition for the same tmClubId must not resolve (dataset is competition-scoped).
  assert.equal(getClubContactData({ id: "some-prisma-id", tmClubId: inter.tmClubId, competition: "IT2" }), null);
  // Unknown tmClubId resolves to no data, not fabricated data.
  assert.equal(getClubContactData({ id: "some-prisma-id", tmClubId: "0", competition: "IT1" }), null);
});
