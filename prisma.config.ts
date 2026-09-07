import "dotenv/config";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: `file:${resolve((process.env.DATABASE_URL ?? "file:./prisma/dev.db").replace(/^file:/, ""))}`,
  },
});
