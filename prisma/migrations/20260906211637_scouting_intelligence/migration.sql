-- CreateTable
CREATE TABLE "PlayerOpportunityHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "total" REAL NOT NULL,
    "contractScore" REAL NOT NULL,
    "representationScore" REAL NOT NULL,
    "playingTimeScore" REAL NOT NULL,
    "ageScore" REAL NOT NULL,
    "marketAccessibilityScore" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "confidenceReasonsJson" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerOpportunityHistory_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClubNeedHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "total" REAL NOT NULL,
    "depthScore" REAL NOT NULL,
    "contractRiskScore" REAL NOT NULL,
    "ageRiskScore" REAL NOT NULL,
    "qualityDepthScore" REAL NOT NULL,
    "currentDepth" INTEGER NOT NULL,
    "projectedDepth12Months" INTEGER NOT NULL,
    "idealDepth" INTEGER NOT NULL,
    "avgAge" REAL,
    "expiring6Months" INTEGER NOT NULL,
    "expiring12Months" INTEGER NOT NULL,
    "unknownRoleCount" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL,
    "compositionHash" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClubNeedHistory_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "PlayerEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClubEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "ClubEvent_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerNote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT
);

-- CreateTable
CREATE TABLE "PlayerTagAssignment" (
    "playerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("playerId", "tagId"),
    CONSTRAINT "PlayerTagAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PlayerTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tmPlayerId" TEXT NOT NULL,
    "tmUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "birthDate" DATETIME,
    "age" INTEGER,
    "birthPlace" TEXT,
    "nationalities" TEXT NOT NULL DEFAULT '[]',
    "heightCm" INTEGER,
    "preferredFoot" TEXT,
    "mainPosition" TEXT,
    "positionGroup" TEXT,
    "secondaryPositions" TEXT,
    "shirtNumber" TEXT,
    "clubId" TEXT,
    "joinedDate" DATETIME,
    "contractExpires" DATETIME,
    "contractOption" TEXT,
    "marketValueEur" INTEGER,
    "marketValueRaw" TEXT,
    "agentRaw" TEXT,
    "agencyName" TEXT,
    "representationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "manuallyAdded" BOOLEAN NOT NULL DEFAULT false,
    "profileLastSyncedAt" DATETIME,
    "performanceLastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "confirmedFreeAgent" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Player_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Player" ("age", "agencyName", "agentRaw", "birthDate", "birthPlace", "clubId", "contractExpires", "contractOption", "createdAt", "firstName", "heightCm", "id", "joinedDate", "lastName", "mainPosition", "manuallyAdded", "marketValueEur", "marketValueRaw", "name", "nationalities", "performanceLastSyncedAt", "positionGroup", "preferredFoot", "profileLastSyncedAt", "representationStatus", "secondaryPositions", "shirtNumber", "tmPlayerId", "tmUrl", "updatedAt") SELECT "age", "agencyName", "agentRaw", "birthDate", "birthPlace", "clubId", "contractExpires", "contractOption", "createdAt", "firstName", "heightCm", "id", "joinedDate", "lastName", "mainPosition", "manuallyAdded", "marketValueEur", "marketValueRaw", "name", "nationalities", "performanceLastSyncedAt", "positionGroup", "preferredFoot", "profileLastSyncedAt", "representationStatus", "secondaryPositions", "shirtNumber", "tmPlayerId", "tmUrl", "updatedAt" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_tmPlayerId_key" ON "Player"("tmPlayerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlayerOpportunityHistory_isCurrent_total_idx" ON "PlayerOpportunityHistory"("isCurrent", "total");

-- CreateIndex
CREATE INDEX "PlayerOpportunityHistory_playerId_calculatedAt_idx" ON "PlayerOpportunityHistory"("playerId", "calculatedAt");

-- CreateIndex
CREATE INDEX "ClubNeedHistory_isCurrent_total_idx" ON "ClubNeedHistory"("isCurrent", "total");

-- CreateIndex
CREATE INDEX "ClubNeedHistory_clubId_role_calculatedAt_idx" ON "ClubNeedHistory"("clubId", "role", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerEvent_dedupeKey_key" ON "PlayerEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "PlayerEvent_createdAt_idx" ON "PlayerEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PlayerEvent_playerId_createdAt_idx" ON "PlayerEvent"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "PlayerEvent_type_severity_readAt_idx" ON "PlayerEvent"("type", "severity", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClubEvent_dedupeKey_key" ON "ClubEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "ClubEvent_createdAt_idx" ON "ClubEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ClubEvent_type_severity_readAt_idx" ON "ClubEvent"("type", "severity", "readAt");

-- CreateIndex
CREATE INDEX "PlayerNote_playerId_createdAt_idx" ON "PlayerNote"("playerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerTag_name_key" ON "PlayerTag"("name");
