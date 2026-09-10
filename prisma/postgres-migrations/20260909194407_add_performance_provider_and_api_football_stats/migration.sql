-- CreateEnum
CREATE TYPE "PerformanceSource" AS ENUM ('API_FOOTBALL', 'TRANSFERMARKT', 'SEED');
-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "apiFootballPlayerId" INTEGER;
-- AlterTable
ALTER TABLE "PlayerPerformance" ADD COLUMN     "captain" BOOLEAN,
ADD COLUMN     "dribblesAttempts" INTEGER,
ADD COLUMN     "dribblesPast" INTEGER,
ADD COLUMN     "dribblesSuccess" INTEGER,
ADD COLUMN     "duelsTotal" INTEGER,
ADD COLUMN     "duelsWon" INTEGER,
ADD COLUMN     "foulsCommitted" INTEGER,
ADD COLUMN     "foulsDrawn" INTEGER,
ADD COLUMN     "goalsConceded" INTEGER,
ADD COLUMN     "lineups" INTEGER,
ADD COLUMN     "passesAccuracy" DOUBLE PRECISION,
ADD COLUMN     "passesKey" INTEGER,
ADD COLUMN     "passesTotal" INTEGER,
ADD COLUMN     "penaltyCommitted" INTEGER,
ADD COLUMN     "penaltyMissed" INTEGER,
ADD COLUMN     "penaltySaved" INTEGER,
ADD COLUMN     "penaltyScored" INTEGER,
ADD COLUMN     "penaltyWon" INTEGER,
ADD COLUMN     "position" TEXT,
ADD COLUMN     "provider" "PerformanceSource" NOT NULL DEFAULT 'TRANSFERMARKT',
ADD COLUMN     "providerPlayerId" TEXT,
ADD COLUMN     "providerStats" JSONB,
ADD COLUMN     "providerUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "saves" INTEGER,
ADD COLUMN     "shotsOn" INTEGER,
ADD COLUMN     "shotsTotal" INTEGER,
ADD COLUMN     "substituteBench" INTEGER,
ADD COLUMN     "substituteIn" INTEGER,
ADD COLUMN     "substituteOut" INTEGER,
ADD COLUMN     "tacklesBlocks" INTEGER,
ADD COLUMN     "tacklesInterceptions" INTEGER,
ADD COLUMN     "tacklesTotal" INTEGER;
-- CreateIndex
CREATE UNIQUE INDEX "Player_apiFootballPlayerId_key" ON "Player"("apiFootballPlayerId");

-- Backfill: every existing PlayerPerformance row was written by the Transfermarkt pipeline.
-- provider defaults to TRANSFERMARKT above; mirror the known freshness timestamp.
UPDATE "PlayerPerformance" SET "providerUpdatedAt" = "sourceUpdatedAt" WHERE "providerUpdatedAt" IS NULL;
