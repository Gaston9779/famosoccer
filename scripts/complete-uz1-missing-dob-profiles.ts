import "dotenv/config";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { playerScopeWhere, saveProfile } from "../src/lib/services/players";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { normalizeRole } from "../src/lib/scoring/roles";

const excluded = new Set(["Husanboy Umirzoqov", "Amirbek Berdiyev", "Yahyo To'xtashev"]);
const validIdentity = (p: { tmPlayerId: string; tmUrl: string }) =>
  /^[1-9]\d*$/.test(p.tmPlayerId) && /^https?:\/\/(?:www\.)?transfermarkt\.[^/]+\/[^/]+\/profil\/spieler\/[1-9]\d*\/?$/i.test(p.tmUrl);
const select = { id: true, name: true, tmPlayerId: true, tmUrl: true, birthDate: true, age: true, mainPosition: true, positionGroup: true, portraitUrl: true, preferredFoot: true, contractExpires: true, marketValueEur: true, representationStatus: true, profileLastSyncedAt: true } as const;
function fields(p: typeof select extends never ? never : any) {
  return {
    dob: !!p.birthDate, age: p.age !== null || !!p.birthDate, role: normalizeRole(p.mainPosition) !== "UNKNOWN",
    foot: p.preferredFoot !== "UNKNOWN", photo: !!p.portraitUrl?.trim(), contract: !!p.contractExpires,
    value: p.marketValueEur !== null, representation: p.representationStatus !== "UNKNOWN",
  };
}

async function main() {
  await withSyncLock(async () => {
    const current = await db.player.findMany({ where: playerScopeWhere("UZBEKISTAN"), select, orderBy: { name: "asc" } });
    const missing = current.filter(p => !p.birthDate);
    const candidates = missing.filter(p => !excluded.has(p.name) && validIdentity(p));
    const excludedRows = current.filter(p => excluded.has(p.name));
    console.log(JSON.stringify({ before: { currentUz1: current.length, ageDobMissing: missing.length, eligible: candidates.length, excluded: excludedRows.map(p => ({ name: p.name, birthDate: p.birthDate, tmPlayerId: p.tmPlayerId })) }, eligible: candidates.map(p => ({ name: p.name, tmPlayerId: p.tmPlayerId, tmUrl: p.tmUrl })) }, null, 2));
    const run = await db.syncRun.create({ data: { type: "UZ1_MISSING_DOB_PROFILE_COMPLETION", metadata: JSON.stringify({ playerIds: candidates.map(p => p.id) }) } });
    const tm = new TransfermarktProvider(new TransfermarktClient(run.id, candidates.length));
    const results: Record<string, unknown>[] = [];
    let consecutive404 = 0, consecutiveZero = 0, stopped = false;
    try {
      for (const [index, player] of candidates.entries()) {
        const before = fields(player);
        try {
          const profile = await tm.fetchPlayerProfile(player.tmPlayerId, player.tmUrl);
          const saved = await saveProfile(profile);
          await db.player.update({ where: { id: saved.id }, data: { preferredFootSyncedAt: new Date() } });
          await calculateAndPersistPlayerOpportunity(saved.id);
          const after = await db.player.findUniqueOrThrow({ where: { id: player.id }, select });
          const afterFields = fields(after);
          const gained = Object.entries(afterFields).filter(([key, value]) => value && !before[key as keyof typeof before]).map(([key]) => key);
          consecutive404 = 0; consecutiveZero = gained.length ? 0 : consecutiveZero + 1;
          results.push({ name: player.name, tmPlayerId: player.tmPlayerId, httpStatus: 200, before, after: afterFields, gained });
        } catch (error) {
          const status = error instanceof ProviderError ? error.status : null;
          consecutive404 = status === 404 ? consecutive404 + 1 : 0;
          results.push({ name: player.name, tmPlayerId: player.tmPlayerId, httpStatus: status, gained: [], reason: error instanceof Error ? error.message : String(error) });
          if (status === 403 || status === 429 || consecutive404 >= 3) { stopped = true; break; }
        }
        if (index === 2) {
          const canary = results.slice(0, 3);
          const successes = canary.filter(r => r.httpStatus === 200).length;
          const useful = canary.filter(r => Array.isArray(r.gained) && r.gained.length > 0).length;
          if (successes < 2 || useful < 2) { stopped = true; break; }
        }
        if (consecutiveZero >= 3) { stopped = true; break; }
      }
      await finishRun(run.id, stopped ? new Error("DOB profile completion stopped by safety rule") : undefined, { results });
    } catch (error) { await finishRun(run.id, error, { results }); throw error; }
    const after = await db.player.findMany({ where: playerScopeWhere("UZBEKISTAN"), select });
    const status = await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
    console.log(JSON.stringify({ after: { currentUz1: after.length, ageKnown: after.filter(p => !!p.birthDate).length, ageDobMissing: after.filter(p => !p.birthDate).length }, http: { attempted: status.requestsAttempted, ok: status.requestsSucceeded, failed: status.requestsFailed, 403: status.http403Count, 429: status.http429Count }, results }, null, 2));
  });
}
try { await main(); } finally { await db.$disconnect(); }
