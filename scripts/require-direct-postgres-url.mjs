import "dotenv/config";

if (!process.env.DIRECT_URL?.startsWith("postgresql://")) {
  throw new Error(
    "DIRECT_URL must be configured with a direct PostgreSQL URL before running Prisma migrations.",
  );
}
