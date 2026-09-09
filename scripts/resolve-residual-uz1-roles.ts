import "dotenv/config";
import * as cheerio from "cheerio";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { saveProfile } from "../src/lib/services/players";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";

const targets = [
  "Asilbek To'xtasinov", "Husanboy Umirzoqov", "Jahongir Hoshimboyev",
  "Mirjalol Abdurahimov", "Yahyo Zuhriddinov", "Yahyoxon Isaqov",
  "Omadillo Abdubannobov", "Ogabek Makhmadaminov", "Odamboy Olimov",
  "Amirbek Berdiyev", "Mukhammadzhon Razhabboev", "Yahyo To'xtashev",
] as const;

const numeric = (value: string) => /^[1-9]\d*$/.test(value);
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().replace(/[ʻʼ'’`-]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
const similarity = (a: string, b: string) => {
  const x = normalize(a), y = normalize(b);
  if (x === y) return 1;
  const m = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) m[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + +(x[i - 1] !== y[j - 1]));
  return 1 - m[x.length][y.length] / Math.max(x.length, y.length);
};
const clubMatches = (source: string | null, actual: string | null) =>
  !!source && !!actual && (normalize(source).includes(normalize(actual)) || normalize(actual).includes(normalize(source)));

function searchCandidates(html: string) {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  return $('a[href*="/profil/spieler/"]').map((_, link) => {
    const href = $(link).attr("href") ?? "";
    const id = href.match(/\/spieler\/(\d+)/)?.[1];
    const name = $(link).text().replace(/\s+/g, " ").trim();
    if (!id || !name || seen.has(id)) return null;
    seen.add(id);
    return { id, name, url: `https://www.transfermarkt.com${href.split("?")[0]}` };
  }).get().filter((x): x is { id: string; name: string; url: string } => x !== null);
}

async function main() {
  await withSyncLock(async () => {
    const players = await db.player.findMany({
      where: { name: { in: [...targets] } },
      include: { club: true },
      orderBy: { name: "asc" },
    });
    if (players.length !== 12) throw new Error(`Expected 12 target records, found ${players.length}`);
    const run = await db.syncRun.create({ data: { type: "UZ1_RESIDUAL_ROLE_TARGETED_PROFILES" } });
    // Profile limit is exactly one per listed player. Search calls are separately accounted.
    const client = new TransfermarktClient(run.id, 30);
    const provider = new TransfermarktProvider(client);
    const results: Record<string, unknown>[] = [];
    let stopped = false;
    let consecutive404 = 0;
    let zeroUseful = 0;
    try {
      for (const player of players) {
        const before = {
          role: player.mainPosition,
          age: player.age ?? player.birthDate,
          photo: !!player.portraitUrl?.trim(), foot: player.preferredFoot,
          contract: player.contractExpires, value: player.marketValueEur,
          representation: player.representationStatus,
        };
        let resolvedId = numeric(player.tmPlayerId) ? player.tmPlayerId : null;
        let resolvedUrl = numeric(player.tmPlayerId) ? player.tmUrl : null;
        let profile: Awaited<ReturnType<TransfermarktProvider["fetchPlayerProfile"]>> | null = null;
        let outcome: "RESOLVED" | "PARTIAL" | "UNRESOLVED" = "UNRESOLVED";
        let reason: string | null = null;
        try {
          if (!resolvedId) {
            const path = `/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(player.name)}`;
            const candidates = searchCandidates(await client.request(path, "html"));
            const best = candidates.map(candidate => ({ ...candidate, score: similarity(player.name, candidate.name) }))
              .sort((a, b) => b.score - a.score)[0];
            // Search output alone is never sufficient: profile facts below must verify it.
            if (!best || best.score < 0.88) {
              reason = "No safely matching Transfermarkt search result";
              results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: null, httpProfileStatus: null, roleBefore: before.role, roleAfter: before.role, result: outcome, reason });
              continue;
            }
            resolvedId = best.id;
            resolvedUrl = best.url;
          }
          profile = await provider.fetchPlayerProfile(resolvedId, resolvedUrl);
          const nameScore = similarity(player.name, profile.name);
          const dobMatches = !player.birthDate || !profile.birthDate || player.birthDate.getTime() === profile.birthDate.getTime();
          const profileClub = profile.currentClub?.name ?? null;
          const sourceClub = player.club?.name ?? null;
          // Numeric IDs already assigned are approved identities. Seeds require independent verification.
          if (!numeric(player.tmPlayerId) && (nameScore < 0.88 || !dobMatches || (profileClub && !clubMatches(sourceClub, profileClub)))) {
            reason = `Candidate verification failed (name=${nameScore.toFixed(2)}, DOB=${dobMatches}, club=${clubMatches(sourceClub, profileClub)})`;
            results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: resolvedId, tmUrl: resolvedUrl, httpProfileStatus: 200, roleBefore: before.role, roleAfter: before.role, result: outcome, reason });
            continue;
          }
          if (!numeric(player.tmPlayerId)) {
            const duplicate = await db.player.findUnique({ where: { tmPlayerId: resolvedId } });
            if (duplicate && duplicate.id !== player.id) {
              reason = `Resolved tmPlayerId already belongs to Player ${duplicate.id}; merge required, not performed by this targeted refresh`;
              results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: resolvedId, tmUrl: resolvedUrl, httpProfileStatus: 200, roleBefore: before.role, roleAfter: before.role, result: outcome, reason });
              continue;
            }
            await db.player.update({ where: { id: player.id }, data: { tmPlayerId: resolvedId, tmUrl: profile.tmUrl } });
          }
          const saved = await saveProfile(profile);
          await db.player.update({ where: { id: saved.id }, data: { preferredFootSyncedAt: new Date() } });
          await calculateAndPersistPlayerOpportunity(saved.id);
          const after = await db.player.findUniqueOrThrow({ where: { id: player.id } });
          const gained = [
            !before.role && after.mainPosition && "role",
            !before.age && (after.age ?? after.birthDate) && "age",
            !before.photo && after.portraitUrl?.trim() && "photo",
            before.foot === "UNKNOWN" && after.preferredFoot !== "UNKNOWN" && "foot",
            !before.contract && after.contractExpires && "contract",
            before.value === null && after.marketValueEur !== null && "marketValue",
            before.representation === "UNKNOWN" && after.representationStatus !== "UNKNOWN" && "representation",
          ].filter(Boolean);
          zeroUseful = gained.length ? 0 : zeroUseful + 1;
          consecutive404 = 0;
          outcome = after.mainPosition && after.positionGroup !== "UNKNOWN" ? "RESOLVED" : "PARTIAL";
          results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: resolvedId, tmUrl: after.tmUrl, httpProfileStatus: 200, roleBefore: before.role, roleAfter: after.mainPosition, ageBefore: before.age, ageAfter: after.age ?? after.birthDate, fieldsGained: gained, result: outcome });
          if (zeroUseful >= 2) { stopped = true; reason = "Two consecutive 200 profiles produced zero useful fields"; break; }
        } catch (error) {
          const status = error instanceof ProviderError ? error.status : null;
          if (status === 404) consecutive404++; else consecutive404 = 0;
          reason = error instanceof Error ? error.message : String(error);
          results.push({ name: player.name, oldIdentity: player.tmPlayerId, resolvedTmId: resolvedId, tmUrl: resolvedUrl, httpProfileStatus: status, roleBefore: before.role, roleAfter: before.role, result: outcome, reason });
          if (status === 403 || status === 429 || consecutive404 >= 2) { stopped = true; break; }
        }
      }
      await finishRun(run.id, stopped ? new Error("Stopped by residual-profile circuit breaker") : undefined, { results });
    } catch (error) {
      await finishRun(run.id, error, { results });
      throw error;
    } finally {
      console.log(JSON.stringify({ runId: run.id, stopped, results }, null, 2));
    }
  });
}

try { await main(); } finally { await db.$disconnect(); }
