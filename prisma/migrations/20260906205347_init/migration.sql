-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tmCompetitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tmClubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tmUrl" TEXT,
    "competitionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    CONSTRAINT "Club_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Player" (
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
    CONSTRAINT "Player_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerPerformance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "competitionName" TEXT NOT NULL,
    "competitionCode" TEXT,
    "competitionKey" TEXT NOT NULL,
    "possibleGames" INTEGER,
    "gamesPlayed" INTEGER,
    "goals" INTEGER,
    "assists" INTEGER,
    "yellowCards" INTEGER,
    "secondYellowCards" INTEGER,
    "redCards" INTEGER,
    "startElevenPercent" REAL,
    "minutesPlayedPercent" REAL,
    "minutesPlayed" INTEGER,
    "sourceUpdatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerPerformance_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "requestsAttempted" INTEGER NOT NULL DEFAULT 0,
    "requestsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "requestsFailed" INTEGER NOT NULL DEFAULT 0,
    "http403Count" INTEGER NOT NULL DEFAULT 0,
    "http429Count" INTEGER NOT NULL DEFAULT 0,
    "http503Count" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "PlayerSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "contractExpires" DATETIME,
    "representationStatus" TEXT NOT NULL,
    "agencyName" TEXT,
    "marketValueEur" INTEGER,
    "clubId" TEXT,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Competition_tmCompetitionId_key" ON "Competition"("tmCompetitionId");

-- CreateIndex
CREATE UNIQUE INDEX "Club_tmClubId_key" ON "Club"("tmClubId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_tmPlayerId_key" ON "Player"("tmPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerPerformance_playerId_season_competitionKey_key" ON "PlayerPerformance"("playerId", "season", "competitionKey");
