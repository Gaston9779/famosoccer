import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { db } from "../db";
import { ProviderError } from "../transfermarkt/errors";
// One process owns all provider work, including CLI and Next.js. Stale lock recovery checks PID.
export async function withSyncLock<T>(work: () => Promise<T>): Promise<T> {
  await mkdir(".runtime", { recursive: true });
  const path = ".runtime/transfermarkt.lock";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, "wx");
      await file.writeFile(String(process.pid));
      await file.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(path, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0)
        throw new ProviderError(
          "SYNC_BUSY",
          "Invalid sync lock; inspect .runtime/transfermarkt.lock.",
        );
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH" && attempt === 0) {
          await unlink(path);
          continue;
        }
      }
      throw new ProviderError(
        "SYNC_BUSY",
        "A Transfermarkt operation is already running.",
      );
    }
  }
  try {
    await db.syncRun.updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "PARTIAL",
        finishedAt: new Date(),
        message: "Previous process stopped; saved state can be resumed.",
      },
    });
    return await work();
  } finally {
    await unlink(path);
  }
}
export async function finishRun(
  id: string,
  error?: unknown,
  metadata?: object,
) {
  const run = await db.syncRun.findUniqueOrThrow({ where: { id } });
  const status =
    run.status === "BLOCKED"
      ? "BLOCKED"
      : error
        ? error instanceof ProviderError && error.code === "BUDGET_EXHAUSTED"
          ? "PARTIAL"
          : run.requestsSucceeded
            ? "PARTIAL"
            : "FAILED"
        : "SUCCESS";
  const result = await db.syncRun.update({
    where: { id },
    data: {
      status,
      finishedAt: new Date(),
      message:
        error instanceof Error ? error.message : error ? String(error) : null,
      ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
    },
  });
  console.log(
    JSON.stringify({
      event: "sync.finished",
      ...result,
      elapsedSeconds: Math.round(
        (Date.now() - result.startedAt.getTime()) / 1000,
      ),
    }),
  );
  return result;
}
