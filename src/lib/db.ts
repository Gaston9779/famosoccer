import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (
  !connectionString ||
  !["postgresql://", "postgres://"].some((protocol) =>
    connectionString.startsWith(protocol),
  )
) {
  throw new Error(
    "DATABASE_URL must be a PostgreSQL pooled connection URL for the application runtime.",
  );
}

const adapter = new PrismaPg(
  { connectionString },
  process.env.DATABASE_SCHEMA ? { schema: process.env.DATABASE_SCHEMA } : undefined,
);

const globalDb = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalDb.db ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalDb.db = db;
