import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const databaseUrl =
  process.env.TURSO_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "file:./prisma/dev.db";

const adapter = new PrismaLibSql({
  url: databaseUrl,
  ...(process.env.TURSO_AUTH_TOKEN
    ? { authToken: process.env.TURSO_AUTH_TOKEN }
    : {}),
});

const globalDb = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalDb.db ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalDb.db = db;
