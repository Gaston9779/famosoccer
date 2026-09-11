import { db } from "../src/lib/db";
import { normalizePosition } from "../src/lib/normalization";

const canonical = new Set(["GK", "CB", "FB", "DM", "CM", "AM", "WINGER", "ST"]);

async function main() {
  const players = await db.player.findMany({
    where: { pools: { some: { poolKey: "ITA" } }, mainPosition: { not: null } },
    select: { id: true, mainPosition: true, positionGroup: true },
  });
  let updated = 0;
  for (const player of players) {
    if (player.positionGroup && canonical.has(player.positionGroup)) continue;
    const positionGroup = normalizePosition(player.mainPosition);
    if (positionGroup === "UNKNOWN") continue;
    await db.player.update({ where: { id: player.id }, data: { positionGroup } });
    updated++;
  }
  const remaining = await db.player.findMany({
    where: { pools: { some: { poolKey: "ITA" } }, mainPosition: { not: null } },
    select: { mainPosition: true, positionGroup: true },
  });
  const unresolved = remaining.filter(player => !player.positionGroup || !canonical.has(player.positionGroup));
  console.log(JSON.stringify({
    updated,
    stillUnknown: unresolved.length,
    distinctStillUnmappedPositions: [...new Set(unresolved.map(player => player.mainPosition).filter(Boolean))].sort(),
  }, null, 2));
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
