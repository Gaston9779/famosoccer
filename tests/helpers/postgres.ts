import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Pool } from "pg";

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function createPostgresTestDatabase() {
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString?.startsWith("postgres")) {
    throw new Error("DIRECT_URL is required to create an isolated PostgreSQL test schema.");
  }

  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString });
  const migrations = readdirSync("prisma/postgres-migrations", {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((entry) => `prisma/postgres-migrations/${entry}/migration.sql`)
    .map((path) => readFileSync(path, "utf8"));
  migrations[0] = migrations[0].replace(
    'CREATE SCHEMA IF NOT EXISTS "public";',
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}; SET search_path TO ${quoteIdentifier(schema)};`,
  );

  await pool.query(migrations.join("\n"));

  return {
    connectionString,
    schema,
    async cleanup() {
      await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await pool.end();
    },
  };
}
