import "dotenv/config";
import { db } from "../src/lib/db";
import { playerScopeWhere } from "../src/lib/services/players";

const uz1 = { club: { is: { competition: { is: { tmCompetitionId: "UZ1" } } } } } as const;
const statusCounts = async () => Object.fromEntries((await db.player.groupBy({ by: ["careerStatus"], _count: { _all: true } })).map(row => [row.careerStatus, row._count._all]));
const tabCounts = async () => ({ uzbekistan: await db.player.count({ where: playerScopeWhere("UZBEKISTAN") }), other: await db.player.count({ where: playerScopeWhere("OTHER") }) });

const before = {
  tabs: await tabCounts(),
  statuses: await statusCounts(),
  unknownUz1: await db.player.count({ where: { careerStatus: "UNKNOWN", ...uz1 } }),
  activeUz1: await db.player.count({ where: { careerStatus: "ACTIVE", ...uz1 } }),
  unknownClub: await db.player.count({ where: { careerStatus: "UNKNOWN", clubId: { not: null } } }),
  unknownNoClub: await db.player.count({ where: { careerStatus: "UNKNOWN", clubId: null } }),
  examples: await db.player.findMany({ where: { careerStatus: "UNKNOWN", ...uz1 }, take: 10, select: { name: true, careerStatus: true, club: { select: { name: true, competition: { select: { tmCompetitionId: true } } } } }, orderBy: { name: "asc" } }),
};
const unknownToActive = await db.player.updateMany({ where: { careerStatus: "UNKNOWN", clubId: { not: null } }, data: { careerStatus: "ACTIVE", confirmedFreeAgent: false } });
const unknownToFreeAgent = await db.player.updateMany({ where: { careerStatus: "UNKNOWN", confirmedFreeAgent: true }, data: { careerStatus: "FREE_AGENT" } });
const after = {
  tabs: await tabCounts(),
  statuses: await statusCounts(),
  leftUnknown: await db.player.count({ where: { careerStatus: "UNKNOWN" } }),
  incorrectlyOther: await db.player.count({ where: { ...uz1, careerStatus: { notIn: ["FREE_AGENT", "RETIRED"] }, NOT: playerScopeWhere("UZBEKISTAN") } }),
};
console.log(JSON.stringify({ before, backfill: { unknownToActive: unknownToActive.count, unknownToFreeAgent: unknownToFreeAgent.count, preservedRetired: before.statuses.RETIRED ?? 0, preservedFreeAgent: before.statuses.FREE_AGENT ?? 0 }, after }, null, 2));
await db.$disconnect();
