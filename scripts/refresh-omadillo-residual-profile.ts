import "dotenv/config";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { saveProfile } from "../src/lib/services/players";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";

async function main() {
  await withSyncLock(async () => {
    const player = await db.player.findUniqueOrThrow({ where: { tmPlayerId: "1419072" } });
    const run = await db.syncRun.create({ data: { type: "UZ1_RESIDUAL_OMADILLO_PROFILE" } });
    try {
      const profile = await new TransfermarktProvider(new TransfermarktClient(run.id, 1)).fetchPlayerProfile(player.tmPlayerId, player.tmUrl);
      const saved = await saveProfile(profile);
      await db.player.update({ where: { id: saved.id }, data: { preferredFootSyncedAt: new Date() } });
      await calculateAndPersistPlayerOpportunity(saved.id);
      await finishRun(run.id, undefined, { roleBefore: player.mainPosition, roleAfter: saved.mainPosition });
      console.log(JSON.stringify({ roleBefore: player.mainPosition, roleAfter: saved.mainPosition }));
    } catch (error) { await finishRun(run.id, error); throw error; }
  });
}
try { await main(); } finally { await db.$disconnect(); }
