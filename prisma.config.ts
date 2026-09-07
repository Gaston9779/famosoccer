import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/postgres-migrations",
  },
  datasource: {
    // Direct Neon connections are for Prisma CLI and migrations. The running
    // application uses DATABASE_URL through the PostgreSQL driver adapter.
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      "postgresql://unused:unused@localhost:5432/famosoccer",
  },
});
