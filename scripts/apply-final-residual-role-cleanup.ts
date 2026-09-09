import "dotenv/config";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { genericRoleFallback } from "../src/lib/scoring/roles";

const aliases = [
  ["Asilbek To'xtasinov", "Asilbek Tozhidinov", "1004468", "asilbek-tozhidinov"],
  ["Jahongir Hoshimboyev", "Jakhongir Khoshimboev", "1241167", "jakhongir-khoshimboev"],
  ["Mirjalol Abdurahimov", "Mirzhalol Abdumutalov", "659930", "mirzhalol-abdumutalov"],
  ["Yahyo Zuhriddinov", "Nuriddin Nuriddinov", "1134139", "nuriddin-nuriddinov"],
  ["Yahyoxon Isaqov", "Yakhyokhon Isakov", "1587896", "yakhyokhon-isakov"],
] as const;

async function main() {
  const changed: { id: string; name: string; tmPlayerId: string; mainPosition: string | null; positionGroup: string | null }[] = [];
  for (const [seedName, canonicalName, tmPlayerId, slug] of aliases) {
    const duplicate = await db.player.findUnique({ where: { tmPlayerId } });
    // A previous partial run may already have converted this exact same row.
    if (duplicate && duplicate.name === canonicalName) {
      changed.push({ id: duplicate.id, name: duplicate.name, tmPlayerId: duplicate.tmPlayerId, mainPosition: duplicate.mainPosition, positionGroup: duplicate.positionGroup });
      continue;
    }
    const seed = await db.player.findFirstOrThrow({ where: { name: seedName } });
    if (duplicate && duplicate.id !== seed.id) throw new Error(`${seedName}: tmPlayerId ${tmPlayerId} already belongs to ${duplicate.id}`);
    const fallback = genericRoleFallback(seed.mainPosition);
    const player = await db.player.update({
      where: { id: seed.id },
      data: {
        name: canonicalName,
        tmPlayerId,
        tmUrl: `https://www.transfermarkt.com/${slug}/profil/spieler/${tmPlayerId}`,
        ...(fallback ?? {}),
      },
      select: { id: true, name: true, tmPlayerId: true, mainPosition: true, positionGroup: true },
    });
    await calculateAndPersistPlayerOpportunity(player.id);
    changed.push(player);
  }
  // The remaining current seeds are intentionally excluded from identity lookup,
  // but their broad source position is sufficient for the approved fallback.
  const remaining = await db.player.findMany({
    where: { tmPlayerId: { startsWith: "seed:UZ1-2026-" }, name: { in: ["Amirbek Berdiyev", "Husanboy Umirzoqov", "Yahyo To'xtashev"] } },
    select: { id: true, name: true, tmPlayerId: true, mainPosition: true },
  });
  for (const seed of remaining) {
    const fallback = genericRoleFallback(seed.mainPosition);
    if (!fallback) throw new Error(`${seed.name}: no approved broad role fallback`);
    const player = await db.player.update({ where: { id: seed.id }, data: fallback, select: { id: true, name: true, tmPlayerId: true, mainPosition: true, positionGroup: true } });
    await calculateAndPersistPlayerOpportunity(player.id);
    changed.push(player);
  }
  console.log(JSON.stringify({ changed }, null, 2));
}
try { await main(); } finally { await db.$disconnect(); }
