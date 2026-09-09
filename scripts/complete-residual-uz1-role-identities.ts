import "dotenv/config";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { saveProfile } from "../src/lib/services/players";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";

const seedNames = [
  "Amirbek Berdiyev", "Asilbek To'xtasinov", "Husanboy Umirzoqov",
  "Jahongir Hoshimboyev", "Mirjalol Abdurahimov", "Yahyo To'xtashev",
  "Yahyo Zuhriddinov", "Yahyoxon Isaqov",
] as const;
const normalize = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().replace(/[ʻʼ'’`-]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
const similarity = (a: string, b: string) => {
  const x = normalize(a), y = normalize(b); if (x === y) return 1;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + +(x[i - 1] !== y[j - 1]));
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
};
const clubMatches = (a: string | null, b: string | null) => !!a && !!b && (normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a)));

async function main() {
  await withSyncLock(async () => {
    const players = await db.player.findMany({ where: { name: { in: [...seedNames] } }, include: { club: true }, orderBy: { name: "asc" } });
    if (players.length !== seedNames.length) throw new Error(`Expected ${seedNames.length} seeds; got ${players.length}`);
    const run = await db.syncRun.create({ data: { type: "UZ1_RESIDUAL_ROLE_ROSTER_IDENTITY" } });
    const tm = new TransfermarktProvider(new TransfermarktClient(run.id, 12));
    const clubs = [...new Set(players.map(p => p.club?.tmClubId).filter((id): id is string => !!id))];
    const listings = new Map<string, Awaited<ReturnType<typeof tm.players>>>();
    const results: Record<string, unknown>[] = [];
    try {
      // These two current-club roster calls are identity evidence for only the listed seeds.
      for (const clubId of clubs) listings.set(clubId, await tm.players(clubId));
      for (const player of players) {
        const before = { role: player.mainPosition, age: player.age ?? player.birthDate, photo: !!player.portraitUrl?.trim(), foot: player.preferredFoot, contract: player.contractExpires, value: player.marketValueEur, representation: player.representationStatus };
        const roster = listings.get(player.club!.tmClubId) ?? [];
        const best = roster.map(row => ({ ...row, score: similarity(player.name, row.name) })).sort((a, b) => b.score - a.score)[0];
        if (!best || best.score < 0.88) {
          results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: null, tmUrl: null, httpProfileStatus: null, roleBefore: before.role, roleAfter: before.role, result: "UNRESOLVED", reason: "No strongly matching current-club roster identity" });
          continue;
        }
        let profile: Awaited<ReturnType<typeof tm.fetchPlayerProfile>>;
        try { profile = await tm.fetchPlayerProfile(best.id, best.link); }
        catch (error) {
          const status = error instanceof ProviderError ? error.status : null;
          results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: best.id, tmUrl: best.link, httpProfileStatus: status, roleBefore: before.role, roleAfter: before.role, result: "UNRESOLVED", reason: error instanceof Error ? error.message : String(error) });
          if (status === 403 || status === 429) break;
          continue;
        }
        const nameScore = similarity(player.name, profile.name);
        const dobMatches = !player.birthDate || !profile.birthDate || player.birthDate.getTime() === profile.birthDate.getTime();
        if (nameScore < .88 || !dobMatches || (profile.currentClub?.name && !clubMatches(player.club?.name ?? null, profile.currentClub.name))) {
          results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: best.id, tmUrl: profile.tmUrl, httpProfileStatus: 200, roleBefore: before.role, roleAfter: before.role, result: "UNRESOLVED", reason: `Profile evidence did not verify roster candidate (name=${nameScore.toFixed(2)}, DOB=${dobMatches}, club=${clubMatches(player.club?.name ?? null, profile.currentClub?.name ?? null)})` });
          continue;
        }
        const duplicate = await db.player.findUnique({ where: { tmPlayerId: best.id } });
        if (duplicate && duplicate.id !== player.id) {
          results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: best.id, tmUrl: profile.tmUrl, httpProfileStatus: 200, roleBefore: before.role, roleAfter: before.role, result: "UNRESOLVED", reason: `Canonical player ${duplicate.id} already exists; requires a merge and was not changed` });
          continue;
        }
        await db.player.update({ where: { id: player.id }, data: { tmPlayerId: best.id, tmUrl: profile.tmUrl } });
        const saved = await saveProfile(profile);
        await db.player.update({ where: { id: saved.id }, data: { preferredFootSyncedAt: new Date() } });
        await calculateAndPersistPlayerOpportunity(saved.id);
        const after = await db.player.findUniqueOrThrow({ where: { id: player.id } });
        const gained = [
          after.mainPosition !== before.role && after.positionGroup !== "UNKNOWN" && "role",
          !before.age && (after.age ?? after.birthDate) && "age",
          !before.photo && after.portraitUrl?.trim() && "photo",
          before.foot === "UNKNOWN" && after.preferredFoot !== "UNKNOWN" && "foot",
          !before.contract && after.contractExpires && "contract",
          before.value === null && after.marketValueEur !== null && "marketValue",
          before.representation === "UNKNOWN" && after.representationStatus !== "UNKNOWN" && "representation",
        ].filter(Boolean);
        results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: best.id, tmUrl: after.tmUrl, httpProfileStatus: 200, roleBefore: before.role, roleAfter: after.mainPosition, ageBefore: before.age, ageAfter: after.age ?? after.birthDate, fieldsGained: gained, result: after.positionGroup === "UNKNOWN" ? "PARTIAL" : "RESOLVED" });
      }
      await finishRun(run.id, undefined, { results });
    } catch (error) { await finishRun(run.id, error, { results }); throw error; }
    finally { console.log(JSON.stringify({ runId: run.id, results }, null, 2)); }
  });
}
try { await main(); } finally { await db.$disconnect(); }
