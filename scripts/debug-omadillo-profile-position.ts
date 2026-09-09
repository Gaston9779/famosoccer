import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";

const id = "1419072";
const path = "/omadillo-abdubannobov/profil/spieler/1419072";
const output = "data/debug/omadillo-abdubannobov-1419072.html";

async function main() {
  await withSyncLock(async () => {
    const run = await db.syncRun.create({ data: { type: "DEBUG_OMADILLO_PROFILE_POSITION" } });
    try {
      const html = await new TransfermarktClient(run.id, 1).request(path, "html");
      await mkdir("data/debug", { recursive: true });
      await writeFile(output, html, "utf8");
      await finishRun(run.id, undefined, { output, bytes: Buffer.byteLength(html) });
      console.log(JSON.stringify({ httpStatus: 200, output, bytes: Buffer.byteLength(html) }));
    } catch (error) { await finishRun(run.id, error); throw error; }
  });
}
try { await main(); } finally { await db.$disconnect(); }
