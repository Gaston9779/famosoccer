import "dotenv/config";
import { db } from "../src/lib/db";
import { importUzbekistanSeedFile } from "../src/lib/services/uzbekistanSeed";

const path = process.argv[2];
if (!path) throw new Error("Usage: tsx scripts/import-uzbekistan-seed.ts <seed.json>");

try {
  console.log(JSON.stringify(await importUzbekistanSeedFile(path), null, 2));
} finally {
  await db.$disconnect();
}
