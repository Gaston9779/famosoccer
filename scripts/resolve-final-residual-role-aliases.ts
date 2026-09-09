import "dotenv/config";
import * as cheerio from "cheerio";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { saveProfile } from "../src/lib/services/players";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";

const aliases = {
  "Asilbek To'xtasinov": "Asilbek Tozhidinov",
  "Jahongir Hoshimboyev": "Jakhongir Khoshimboev",
  "Mirjalol Abdurahimov": "Mirzhalol Abdumutalov",
  "Yahyo Zuhriddinov": "Nuriddin Nuriddinov",
  "Yahyoxon Isaqov": "Yakhyokhon Isakov",
} as const;
const normalize = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().replace(/[ʻʼ'’`-]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
const similarity = (a: string, b: string) => {
  const x = normalize(a), y = normalize(b); if (x === y) return 1;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + +(x[i - 1] !== y[j - 1]));
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
};
const clubMatches = (a: string | null, b: string | null) => !!a && !!b && (normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a)));
function candidates(html: string) {
  const $ = cheerio.load(html), found = new Set<string>();
  return $('a[href*="/profil/spieler/"]').map((_, el) => {
    const href = $(el).attr("href") ?? "", id = href.match(/\/spieler\/(\d+)/)?.[1], name = $(el).text().replace(/\s+/g, " ").trim();
    if (!id || !name || found.has(id)) return null;
    found.add(id); return { id, name, url: `https://www.transfermarkt.com${href.split("?")[0]}` };
  }).get().filter((x): x is { id: string; name: string; url: string } => x !== null);
}

async function main() {
  await withSyncLock(async () => {
    const players = await db.player.findMany({ where: { name: { in: Object.keys(aliases) } }, include: { club: true }, orderBy: { name: "asc" } });
    if (players.length !== Object.keys(aliases).length) throw new Error(`Expected five alias seeds, found ${players.length}`);
    const run = await db.syncRun.create({ data: { type: "UZ1_FINAL_RESIDUAL_ROLE_ALIASES" } });
    const client = new TransfermarktClient(run.id, 10), tm = new TransfermarktProvider(client), results: Record<string, unknown>[] = [];
    try {
      for (const player of players) {
        const alias = aliases[player.name as keyof typeof aliases];
        const before = { role: player.mainPosition, age: player.age ?? player.birthDate, photo: !!player.portraitUrl?.trim(), foot: player.preferredFoot, contract: player.contractExpires, value: player.marketValueEur, representation: player.representationStatus };
        try {
          const search = candidates(await client.request(`/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(alias)}`, "html"));
          const best = search.map(c => ({ ...c, score: similarity(alias, c.name) })).sort((a, b) => b.score - a.score)[0];
          if (!best || best.score < .9) { results.push({ name: player.name, alias, result: "UNRESOLVED", reason: "Alias search returned no strongly matching Transfermarkt profile" }); continue; }
          const profile = await tm.fetchPlayerProfile(best.id, best.url);
          const aliasScore = similarity(alias, profile.name);
          const dobMatches = !player.birthDate || !profile.birthDate || player.birthDate.getTime() === profile.birthDate.getTime();
          const sourceClub = player.club?.name ?? null;
          if (aliasScore < .9 || !dobMatches || (profile.currentClub?.name && !clubMatches(sourceClub, profile.currentClub.name))) {
            results.push({ name: player.name, alias, candidateTmPlayerId: best.id, candidateName: profile.name, httpProfileStatus: 200, result: "UNRESOLVED", reason: `Candidate did not verify against source facts (alias=${aliasScore.toFixed(2)}, DOB=${dobMatches}, club=${clubMatches(sourceClub, profile.currentClub?.name ?? null)})` }); continue;
          }
          const duplicate = await db.player.findUnique({ where: { tmPlayerId: best.id } });
          if (duplicate && duplicate.id !== player.id) { results.push({ name: player.name, alias, candidateTmPlayerId: best.id, httpProfileStatus: 200, result: "UNRESOLVED", reason: `Canonical Player ${duplicate.id} exists; merge not performed in alias attachment` }); continue; }
          await db.player.update({ where: { id: player.id }, data: { tmPlayerId: best.id, tmUrl: profile.tmUrl } });
          const saved = await saveProfile(profile);
          await db.player.update({ where: { id: saved.id }, data: { preferredFootSyncedAt: new Date() } });
          await calculateAndPersistPlayerOpportunity(saved.id);
          const after = await db.player.findUniqueOrThrow({ where: { id: player.id } });
          const gained = [after.mainPosition !== before.role && after.mainPosition && "role", !before.age && (after.age ?? after.birthDate) && "age", !before.photo && after.portraitUrl?.trim() && "photo", before.foot === "UNKNOWN" && after.preferredFoot !== "UNKNOWN" && "foot", !before.contract && after.contractExpires && "contract", before.value === null && after.marketValueEur !== null && "marketValue", before.representation === "UNKNOWN" && after.representationStatus !== "UNKNOWN" && "representation"].filter(Boolean);
          results.push({ name: player.name, alias, resolvedTmPlayerId: best.id, tmUrl: after.tmUrl, httpProfileStatus: 200, roleBefore: before.role, roleAfter: after.mainPosition, fieldsGained: gained, result: "RESOLVED" });
        } catch (error) {
          const status = error instanceof ProviderError ? error.status : null;
          results.push({ name: player.name, alias, httpProfileStatus: status, result: "UNRESOLVED", reason: error instanceof Error ? error.message : String(error) });
          if (status === 403 || status === 429) break;
        }
      }
      await finishRun(run.id, undefined, { results });
    } catch (error) { await finishRun(run.id, error, { results }); throw error; }
    finally { console.log(JSON.stringify({ runId: run.id, results }, null, 2)); }
  });
}
try { await main(); } finally { await db.$disconnect(); }
