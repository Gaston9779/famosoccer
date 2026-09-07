import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSquadPortraits } from "../src/lib/transfermarkt/parsers/squad";
test("extracts the portrait URL supplied by a squad row image", () => {
  assert.deepEqual(parseSquadPortraits('<a href="/a/profil/spieler/123"><img data-src="https://img.a.transfermarkt.technology/portrait/big/123.png" /></a>'), [{tmPlayerId:"123",portraitUrl:"https://img.a.transfermarkt.technology/portrait/big/123.png"}]);
});
