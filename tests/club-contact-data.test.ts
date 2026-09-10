import assert from "node:assert/strict";
import { test } from "node:test";
import database from "../src/data/club-intelligence/uzbekistan_football_prospect_database_2026.json";
import { getClubContactData } from "../src/lib/intelligence/club-contact-data";

test("club intelligence uses exact Prisma Club IDs and keeps Super League IDs unique", () => {
  const superLeagueClubs = database.clubs.filter((club) => club.league === "Super League");
  const ids = superLeagueClubs.map((club) => club.club_id);

  assert.equal(superLeagueClubs.length, 16);
  assert.equal(new Set(ids).size, ids.length);

  const bunyodkor = superLeagueClubs.find((club) => club.club_name === "Bunyodkor");
  assert.ok(bunyodkor);
  assert.equal(getClubContactData(bunyodkor.club_id)?.club_name, "Bunyodkor");
  assert.equal(getClubContactData("Bunyodkor"), null);
  assert.equal(getClubContactData(bunyodkor.club_id)?.contacts.length, 3);
});
