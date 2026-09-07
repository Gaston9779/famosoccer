import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import { PrismaClient } from "../src/generated/prisma/client";

const localUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoAuthToken) {
  throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
}

const source = new PrismaClient({
  adapter: new PrismaLibSql({ url: localUrl }),
});
const destination = new PrismaClient({
  adapter: new PrismaLibSql({ url: tursoUrl, authToken: tursoAuthToken }),
});
const remote = createClient({ url: tursoUrl, authToken: tursoAuthToken });

const models = [
  "competition",
  "club",
  "player",
  "playerPerformance",
  "syncRun",
  "playerSnapshot",
  "playerOpportunityHistory",
  "clubNeedHistory",
  "playerEvent",
  "clubEvent",
  "playerNote",
  "playerTag",
  "playerTagAssignment",
] as const;

type ModelName = (typeof models)[number];
type PrismaDelegate = {
  count: () => Promise<number>;
  findMany: () => Promise<unknown[]>;
  createMany: (args: { data: unknown[] }) => Promise<unknown>;
};

function delegate(client: PrismaClient, model: ModelName): PrismaDelegate {
  return client[model] as unknown as PrismaDelegate;
}

async function counts(client: PrismaClient) {
  return Object.fromEntries(
    await Promise.all(
      models.map(async (model) => [model, await delegate(client, model).count()]),
    ),
  ) as Record<ModelName, number>;
}

async function applyMigrations() {
  await remote.executeMultiple(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);

  const migrationsDirectory = join(process.cwd(), "prisma", "migrations");
  const migrationNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const applied = await remote.execute({
      sql: 'SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = ? LIMIT 1',
      args: [migrationName],
    });
    if (applied.rows.length) continue;

    const sql = await readFile(join(migrationsDirectory, migrationName, "migration.sql"), "utf8");
    await remote.executeMultiple(sql);
    await remote.execute({
      sql: `INSERT INTO "_prisma_migrations" (
        "id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count"
      ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, 1)`,
      args: [
        crypto.randomUUID(),
        createHash("sha256").update(sql).digest("hex"),
        migrationName,
      ],
    });
  }
}

async function copyData() {
  for (const model of models) {
    const sourceDelegate = delegate(source, model);
    const rows = await sourceDelegate.findMany();
    if (!rows.length) continue;

    for (let offset = 0; offset < rows.length; offset += 100) {
      await delegate(destination, model).createMany({
        data: rows.slice(offset, offset + 100),
      });
    }
  }
}

async function main() {
  const before = await counts(source);
  const existingDestination = await counts(destination).catch(() => null);

  if (existingDestination && Object.values(existingDestination).some((count) => count > 0)) {
    throw new Error(
      "The Turso database already contains application data. Refusing to overwrite it.",
    );
  }

  await applyMigrations();
  await copyData();

  const after = await counts(destination);
  const mismatches = models.filter((model) => before[model] !== after[model]);
  if (mismatches.length) {
    throw new Error(`Row-count mismatch after copy: ${mismatches.join(", ")}`);
  }

  const currentPlayers = await destination.player.findMany({
    where: { club: { competition: { tmCompetitionId: "UZ1" } } },
    select: { tmPlayerId: true },
  });
  const representativeQuery = await destination.player.findMany({
    where: { club: { competition: { tmCompetitionId: "UZ1" } } },
    take: 10,
    orderBy: { name: "asc" },
    include: { club: true },
  });

  console.log(
    JSON.stringify(
      {
        before,
        after,
        currentUz1Players: new Set(currentPlayers.map((player) => player.tmPlayerId)).size,
        clubs: await destination.club.count(),
        representativePlayerQueryRows: representativeQuery.length,
      },
      null,
      2,
    ),
  );
}

main()
  .finally(async () => {
    await source.$disconnect();
    await destination.$disconnect();
    remote.close();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
