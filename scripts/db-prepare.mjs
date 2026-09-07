import "dotenv/config";
import { mkdirSync, closeSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
const path = resolve(
  (process.env.DATABASE_URL ?? "file:./prisma/dev.db").replace(/^file:/, ""),
);
mkdirSync(dirname(path), { recursive: true });
closeSync(openSync(path, "a"));
