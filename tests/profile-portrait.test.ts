import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePreferredFoot,
  parseProfile,
} from "../src/lib/transfermarkt/parsers/profile";
test("profile parser propagates a real portrait URL", () => {
 const p=parseProfile('<link rel="canonical" href="https://www.transfermarkt.com/test/profil/spieler/123"/><h1>Test Player</h1><div class="info-table__content--regular">Position</div><div class="info-table__content--bold">Centre-Back</div><div class="data-header__profile-image"><img data-src="https://img.a.transfermarkt.technology/portrait/big/123.jpg"/></div>',"123","https://www.transfermarkt.com/test/profil/spieler/123");
 assert.equal(p.portraitUrl,"https://img.a.transfermarkt.technology/portrait/big/123.jpg");
});

test("profile parser normalizes preferred foot to canonical values", () => {
  assert.equal(normalizePreferredFoot("Right"), "RIGHT");
  assert.equal(normalizePreferredFoot("rechts"), "RIGHT");
  assert.equal(normalizePreferredFoot("sinistro"), "LEFT");
  assert.equal(normalizePreferredFoot("both feet"), "BOTH");
  assert.equal(normalizePreferredFoot(null), "UNKNOWN");
  const profile = parseProfile(
    '<link rel="canonical" href="https://www.transfermarkt.com/test/profil/spieler/123"/><h1>Test Player</h1><div class="info-table__content--regular">Position</div><div class="info-table__content--bold">Centre-Back</div><div class="info-table__content--regular">Foot</div><div class="info-table__content--bold">Left</div>',
    "123",
    "https://www.transfermarkt.com/test/profil/spieler/123",
  );
  assert.equal(profile.preferredFoot, "LEFT");
});
