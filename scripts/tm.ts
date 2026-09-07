import "dotenv/config";
import { db } from "../src/lib/db";
import { probe } from "../src/lib/transfermarkt/probe";
import {
  bootstrapUzbekistanSuperLeague,
  refreshUzbekistanSuperLeague,
} from "../src/lib/services/sync";
try {
  const cmd = process.argv[2];
  if (cmd === "probe") {
    const report = await probe();
    if (report.profile !== "PASS" || report.performance !== "PASS")
      process.exitCode = 1;
  } else if (cmd === "bootstrap" || cmd === "small" || cmd === "daily") {
    const run =
      cmd === "daily"
        ? await refreshUzbekistanSuperLeague()
        : await bootstrapUzbekistanSuperLeague(cmd === "small");
    if (["FAILED", "BLOCKED"].includes(run.status)) process.exitCode = 1;
  } else if (cmd === "status")
    console.log(
      JSON.stringify(
        {
          runs: await db.syncRun.findMany({
            orderBy: { startedAt: "desc" },
            take: 20,
          }),
          clubs: await db.club.count(),
          players: await db.player.count(),
          performances: await db.playerPerformance.count(),
          totalRequests: await db.syncRun.aggregate({
            _sum: {
              requestsAttempted: true,
              requestsSucceeded: true,
              requestsFailed: true,
              http403Count: true,
              http429Count: true,
              http503Count: true,
            },
          }),
        },
        null,
        2,
      ),
    );
  else throw new Error("Use probe, bootstrap, small, daily, or status");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
