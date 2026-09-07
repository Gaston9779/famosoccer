/**
 * One-time, local-only transfer from the preserved Prisma 7 SQLite source to
 * an empty Neon PostgreSQL database. This file is intentionally outside src/
 * so better-sqlite3 can never enter the Next.js production runtime.
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

const sourcePath = resolve("prisma/dev.db");
const targetUrl = process.env.DIRECT_URL;

const tables = [
  "Competition",
  "Club",
  "Player",
  "PlayerPerformance",
  "SyncRun",
  "PlayerSnapshot",
  "PlayerOpportunityHistory",
  "ClubNeedHistory",
  "PlayerEvent",
  "ClubEvent",
  "PlayerNote",
  "PlayerTag",
  "PlayerTagAssignment",
] as const;

type TableName = (typeof tables)[number];
type SqliteRow = Record<string, unknown>;

const booleanColumns = new Set([
  "Player.manuallyAdded",
  "Player.confirmedFreeAgent",
  "PlayerOpportunityHistory.isCurrent",
  "ClubNeedHistory.available",
  "ClubNeedHistory.isCurrent",
]);

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sourceCount(source: Database.Database, table: TableName) {
  const result = source
    .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
    .get() as { count: number };
  return result.count;
}

async function targetCount(client: PoolClient, table: TableName) {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function normalizeValue(table: TableName, column: string, value: unknown) {
  if (value === null || value === undefined) return null;
  if (booleanColumns.has(`${table}.${column}`)) return Boolean(value);
  return value;
}

async function verifySchema(client: PoolClient) {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [tables],
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = tables.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(
      `Target schema is incomplete (${missing.join(", ")}). Run \`prisma migrate deploy\` against Neon first.`,
    );
  }
}

async function main() {
  if (!targetUrl?.startsWith("postgresql://")) {
    throw new Error(
      "DIRECT_URL must be a PostgreSQL direct Neon connection URL. No migration was run.",
    );
  }

  const source = new Database(sourcePath, { fileMustExist: true, readonly: true });
  const pool = new Pool({ connectionString: targetUrl });
  const client = await pool.connect();
  let locked = false;

  try {
    // A second concurrently started migration must re-check target emptiness
    // only after the first one has committed.
    await client.query("SELECT pg_advisory_lock(hashtext('famosoccer-sqlite-to-postgres'))");
    locked = true;
    await verifySchema(client);

    const targetCounts = await Promise.all(
      tables.map(async (table) => [table, await targetCount(client, table)] as const),
    );
    const nonEmpty = targetCounts.filter(([, count]) => count > 0);
    if (nonEmpty.length > 0) {
      throw new Error(
        `Target contains application data (${nonEmpty.map(([table, count]) => `${table}: ${count}`).join(", ")}). No migration was run.`,
      );
    }

    await client.query("BEGIN");
    for (const table of tables) {
      const rows = source
        .prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
        .all() as SqliteRow[];
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]!);
      // Keep each statement below PostgreSQL's parameter limit while avoiding
      // thousands of round trips to the remote Neon database.
      const batchSize = Math.min(100, Math.max(1, Math.floor(60_000 / columns.length)));
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        const values = batch.flatMap((row) =>
          columns.map((column) => normalizeValue(table, column, row[column])),
        );
        const placeholders = batch
          .map(
            (_, rowIndex) =>
              `(${columns
                .map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`)
                .join(", ")})`,
          )
          .join(", ");
        await client.query(
          `INSERT INTO ${quoteIdentifier(table)} (${columns
            .map(quoteIdentifier)
            .join(", ")}) VALUES ${placeholders}`,
          values,
        );
      }
    }
    await client.query("COMMIT");

    const mismatches = tables.flatMap((table) => {
      const expected = sourceCount(source, table);
      return [{ table, expected }];
    });
    for (const { table, expected } of mismatches) {
      const actual = await targetCount(client, table);
      if (actual !== expected) {
        throw new Error(
          `Post-migration validation failed for ${table}: expected ${expected}, found ${actual}.`,
        );
      }
    }

    console.log("SQLite to PostgreSQL migration completed with matching row counts.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext('famosoccer-sqlite-to-postgres'))")
        .catch(() => undefined);
    }
    client.release();
    source.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
