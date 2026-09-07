import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  const migration = readFileSync(
    "prisma/postgres-migrations/20260908000000_init/migration.sql",
    "utf8",
  ).replace(
    'CREATE SCHEMA IF NOT EXISTS "public";',
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}; SET search_path TO ${quoteIdentifier(schema)};`,
  );

  await pool.query(migration);

  return {
    connectionString,
    schema,
    async cleanup() {
      await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await pool.end();
    },
  };
}
