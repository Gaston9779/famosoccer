-- Reverses the API-Football experiment. Keeps every generic PlayerPerformance
-- statistic column and the provider/providerStats attribution (useful regardless
-- of source). Removes only the API-Football-specific pieces.
-- No PlayerPerformance rows use 'API_FOOTBALL' (all are 'TRANSFERMARKT'), so the
-- enum narrowing is a safe automatic cast.

-- AlterEnum: PerformanceSource -> { TRANSFERMARKT, SEED }
BEGIN;
CREATE TYPE "PerformanceSource_new" AS ENUM ('TRANSFERMARKT', 'SEED');
ALTER TABLE "PlayerPerformance" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "PlayerPerformance" ALTER COLUMN "provider" TYPE "PerformanceSource_new" USING ("provider"::text::"PerformanceSource_new");
ALTER TYPE "PerformanceSource" RENAME TO "PerformanceSource_old";
ALTER TYPE "PerformanceSource_new" RENAME TO "PerformanceSource";
DROP TYPE "PerformanceSource_old";
ALTER TABLE "PlayerPerformance" ALTER COLUMN "provider" SET DEFAULT 'TRANSFERMARKT';
COMMIT;

-- DropIndex
DROP INDEX "Player_apiFootballPlayerId_key";

-- AlterTable: drop API-Football-specific columns
ALTER TABLE "Player" DROP COLUMN "apiFootballPlayerId";
ALTER TABLE "PlayerPerformance" DROP COLUMN "providerPlayerId",
DROP COLUMN "providerUpdatedAt";
