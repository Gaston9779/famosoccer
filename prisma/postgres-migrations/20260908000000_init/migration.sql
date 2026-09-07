CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "RepresentationStatus" AS ENUM ('NO_AGENT', 'FAMILY', 'AGENCY', 'NOT_LISTED', 'UNKNOWN');
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'BLOCKED');

CREATE TABLE "Competition" (
  "id" TEXT NOT NULL, "tmCompetitionId" TEXT NOT NULL, "name" TEXT NOT NULL, "country" TEXT NOT NULL, "season" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Club" (
  "id" TEXT NOT NULL, "tmClubId" TEXT NOT NULL, "name" TEXT NOT NULL, "tmUrl" TEXT, "competitionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "lastSyncedAt" TIMESTAMP(3),
  CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Player" (
  "id" TEXT NOT NULL, "tmPlayerId" TEXT NOT NULL, "tmUrl" TEXT NOT NULL, "portraitUrl" TEXT, "name" TEXT NOT NULL,
  "firstName" TEXT, "lastName" TEXT, "birthDate" TIMESTAMP(3), "age" INTEGER, "birthPlace" TEXT,
  "nationalities" TEXT NOT NULL DEFAULT '[]', "heightCm" INTEGER, "preferredFoot" TEXT, "mainPosition" TEXT,
  "positionGroup" TEXT, "secondaryPositions" TEXT, "shirtNumber" TEXT, "clubId" TEXT, "joinedDate" TIMESTAMP(3),
  "contractExpires" TIMESTAMP(3), "contractOption" TEXT, "marketValueEur" INTEGER, "marketValueRaw" TEXT,
  "agentRaw" TEXT, "agencyName" TEXT, "representationStatus" "RepresentationStatus" NOT NULL DEFAULT 'UNKNOWN',
  "manuallyAdded" BOOLEAN NOT NULL DEFAULT false, "profileLastSyncedAt" TIMESTAMP(3), "performanceLastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedFreeAgent" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlayerPerformance" (
  "id" TEXT NOT NULL, "playerId" TEXT NOT NULL, "season" TEXT NOT NULL, "competitionName" TEXT NOT NULL,
  "competitionCode" TEXT, "competitionKey" TEXT NOT NULL, "possibleGames" INTEGER, "gamesPlayed" INTEGER,
  "goals" INTEGER, "assists" INTEGER, "yellowCards" INTEGER, "secondYellowCards" INTEGER, "redCards" INTEGER,
  "startElevenPercent" DOUBLE PRECISION, "minutesPlayedPercent" DOUBLE PRECISION, "minutesPlayed" INTEGER,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerPerformance_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SyncRun" (
  "id" TEXT NOT NULL, "type" TEXT NOT NULL, "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  "requestsAttempted" INTEGER NOT NULL DEFAULT 0, "requestsSucceeded" INTEGER NOT NULL DEFAULT 0,
  "requestsFailed" INTEGER NOT NULL DEFAULT 0, "http403Count" INTEGER NOT NULL DEFAULT 0,
  "http429Count" INTEGER NOT NULL DEFAULT 0, "http503Count" INTEGER NOT NULL DEFAULT 0, "message" TEXT, "metadata" TEXT,
  CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlayerSnapshot" (
  "id" TEXT NOT NULL, "playerId" TEXT NOT NULL, "contractExpires" TIMESTAMP(3),
  "representationStatus" "RepresentationStatus" NOT NULL, "agencyName" TEXT, "marketValueEur" INTEGER,
  "clubId" TEXT, "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlayerOpportunityHistory" (
  "id" TEXT NOT NULL, "playerId" TEXT NOT NULL, "total" DOUBLE PRECISION NOT NULL, "contractScore" DOUBLE PRECISION NOT NULL,
  "representationScore" DOUBLE PRECISION NOT NULL, "playingTimeScore" DOUBLE PRECISION NOT NULL,
  "ageScore" DOUBLE PRECISION NOT NULL, "marketAccessibilityScore" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL, "reasonsJson" TEXT NOT NULL, "warningsJson" TEXT NOT NULL,
  "confidenceReasonsJson" TEXT NOT NULL, "algorithmVersion" TEXT NOT NULL, "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerOpportunityHistory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClubNeedHistory" (
  "id" TEXT NOT NULL, "clubId" TEXT NOT NULL, "role" TEXT NOT NULL, "total" DOUBLE PRECISION NOT NULL,
  "depthScore" DOUBLE PRECISION NOT NULL, "contractRiskScore" DOUBLE PRECISION NOT NULL,
  "ageRiskScore" DOUBLE PRECISION NOT NULL, "qualityDepthScore" DOUBLE PRECISION NOT NULL,
  "currentDepth" INTEGER NOT NULL, "projectedDepth12Months" INTEGER NOT NULL, "idealDepth" INTEGER NOT NULL,
  "avgAge" DOUBLE PRECISION, "expiring6Months" INTEGER NOT NULL, "expiring12Months" INTEGER NOT NULL,
  "unknownRoleCount" INTEGER NOT NULL, "available" BOOLEAN NOT NULL, "compositionHash" TEXT NOT NULL,
  "reasonsJson" TEXT NOT NULL, "warningsJson" TEXT NOT NULL, "algorithmVersion" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true, "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubNeedHistory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlayerEvent" (
  "id" TEXT NOT NULL, "playerId" TEXT NOT NULL, "type" TEXT NOT NULL, "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL, "description" TEXT NOT NULL, "oldValue" TEXT, "newValue" TEXT, "metadata" TEXT,
  "dedupeKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3),
  CONSTRAINT "PlayerEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClubEvent" (
  "id" TEXT NOT NULL, "clubId" TEXT NOT NULL, "type" TEXT NOT NULL, "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL, "description" TEXT NOT NULL, "oldValue" TEXT, "newValue" TEXT, "metadata" TEXT,
  "dedupeKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3),
  CONSTRAINT "ClubEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlayerNote" (
  "id" TEXT NOT NULL, "playerId" TEXT NOT NULL, "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerNote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlayerTag" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "color" TEXT,
  CONSTRAINT "PlayerTag_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlayerTagAssignment" (
  "playerId" TEXT NOT NULL, "tagId" TEXT NOT NULL,
  CONSTRAINT "PlayerTagAssignment_pkey" PRIMARY KEY ("playerId", "tagId")
);

CREATE UNIQUE INDEX "Competition_tmCompetitionId_key" ON "Competition"("tmCompetitionId");
CREATE UNIQUE INDEX "Club_tmClubId_key" ON "Club"("tmClubId");
CREATE UNIQUE INDEX "Player_tmPlayerId_key" ON "Player"("tmPlayerId");
CREATE UNIQUE INDEX "PlayerPerformance_playerId_season_competitionKey_key" ON "PlayerPerformance"("playerId", "season", "competitionKey");
CREATE INDEX "PlayerOpportunityHistory_isCurrent_total_idx" ON "PlayerOpportunityHistory"("isCurrent", "total");
CREATE INDEX "PlayerOpportunityHistory_playerId_calculatedAt_idx" ON "PlayerOpportunityHistory"("playerId", "calculatedAt");
CREATE INDEX "ClubNeedHistory_isCurrent_total_idx" ON "ClubNeedHistory"("isCurrent", "total");
CREATE INDEX "ClubNeedHistory_clubId_role_calculatedAt_idx" ON "ClubNeedHistory"("clubId", "role", "calculatedAt");
CREATE UNIQUE INDEX "PlayerEvent_dedupeKey_key" ON "PlayerEvent"("dedupeKey");
CREATE INDEX "PlayerEvent_createdAt_idx" ON "PlayerEvent"("createdAt");
CREATE INDEX "PlayerEvent_playerId_createdAt_idx" ON "PlayerEvent"("playerId", "createdAt");
CREATE INDEX "PlayerEvent_type_severity_readAt_idx" ON "PlayerEvent"("type", "severity", "readAt");
CREATE UNIQUE INDEX "ClubEvent_dedupeKey_key" ON "ClubEvent"("dedupeKey");
CREATE INDEX "ClubEvent_createdAt_idx" ON "ClubEvent"("createdAt");
CREATE INDEX "ClubEvent_type_severity_readAt_idx" ON "ClubEvent"("type", "severity", "readAt");
CREATE INDEX "PlayerNote_playerId_createdAt_idx" ON "PlayerNote"("playerId", "createdAt");
CREATE UNIQUE INDEX "PlayerTag_name_key" ON "PlayerTag"("name");

ALTER TABLE "Club" ADD CONSTRAINT "Club_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlayerPerformance" ADD CONSTRAINT "PlayerPerformance_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerSnapshot" ADD CONSTRAINT "PlayerSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerOpportunityHistory" ADD CONSTRAINT "PlayerOpportunityHistory_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubNeedHistory" ADD CONSTRAINT "ClubNeedHistory_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerEvent" ADD CONSTRAINT "PlayerEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubEvent" ADD CONSTRAINT "ClubEvent_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerNote" ADD CONSTRAINT "PlayerNote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerTagAssignment" ADD CONSTRAINT "PlayerTagAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerTagAssignment" ADD CONSTRAINT "PlayerTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PlayerTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
