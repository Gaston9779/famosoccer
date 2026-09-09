import assert from "node:assert/strict";
import test from "node:test";
import { parseProfile } from "../src/lib/transfermarkt/parsers/profile";
import { normalizeRole } from "../src/lib/scoring/roles";

test("broad Transfermarkt positions use the approved exact-role fallback", () => {
  for (const [raw, role] of [["Defender", "CB"], ["Midfield", "CM"], ["Midfielder", "CM"], ["Attack", "ST"], ["Forward", "ST"]] as const)
    assert.equal(normalizeRole(raw), role);
});

test("profile parser persists the generic midfield fallback", () => {
  const html = '<link rel="canonical" href="https://www.transfermarkt.com/test/profil/spieler/1419072"/><h1>Test Player</h1><span class="info-table__content--regular">Position:</span><span class="info-table__content--bold">Midfield</span>';
  const parsed = parseProfile(html, "1419072", "https://www.transfermarkt.com/test/profil/spieler/1419072");
  assert.equal(parsed.mainPosition, "CM");
  assert.equal(parsed.positionGroup, "MIDFIELDER");
});
