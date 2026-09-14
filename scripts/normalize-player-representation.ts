import "dotenv/config";
import { db } from "../src/lib/db";
import { normalizeRepresentation } from "../src/lib/normalization";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";

// Repairs explicit labels only; absent text must not overwrite known representation.
const apply = process.argv.includes("--apply");
try {
  const players = await db.player.findMany({
    where: { OR: [{ agentRaw: { not: null } }, { agencyName: { not: null } }] },
    select: { id: true, name: true, agentRaw: true, agencyName: true, representationStatus: true },
  });
  const changes = players.flatMap((player) => {
    const text = player.agentRaw?.trim() || player.agencyName?.trim();
    if (!text) return [];
    const normalized = normalizeRepresentation(text);
    if (!["NO_AGENT", "FAMILY"].includes(normalized.representationStatus)) return [];
    if (player.representationStatus === normalized.representationStatus && player.agencyName === normalized.agencyName) return [];
    return [{ player, normalized }];
  });
  console.log(JSON.stringify({ apply, count: changes.length, changes }, null, 2));
  if (apply) {
    for (const { player, normalized } of changes) {
      await db.player.update({ where: { id: player.id }, data: normalized });
      const score = await calculateAndPersistPlayerOpportunity(player.id);
      console.log(JSON.stringify({ playerId: player.id, name: player.name, representation: normalized.representationStatus, representationScore: score.representationScore }));
    }
  }
} finally {
  await db.$disconnect();
}
