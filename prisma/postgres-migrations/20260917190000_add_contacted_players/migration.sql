CREATE TYPE "ContactedPlayerStatus" AS ENUM ('DA_CONTATTARE', 'CONTATTATO', 'RIFIUTATO', 'STALLO');

CREATE TABLE "ContactedPlayer" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "status" "ContactedPlayerStatus" NOT NULL DEFAULT 'DA_CONTATTARE',
  "note" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstContactedAt" TIMESTAMP(3),
  "lastStatusAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactedPlayer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContactedPlayer_playerId_key" ON "ContactedPlayer"("playerId");
CREATE INDEX "ContactedPlayer_status_lastStatusAt_idx" ON "ContactedPlayer"("status", "lastStatusAt");
ALTER TABLE "ContactedPlayer" ADD CONSTRAINT "ContactedPlayer_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContactedPlayerStatusEvent" (
  "id" TEXT NOT NULL,
  "contactedPlayerId" TEXT NOT NULL,
  "status" "ContactedPlayerStatus" NOT NULL,
  "note" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactedPlayerStatusEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContactedPlayerStatusEvent_contactedPlayerId_changedAt_idx" ON "ContactedPlayerStatusEvent"("contactedPlayerId", "changedAt");
ALTER TABLE "ContactedPlayerStatusEvent" ADD CONSTRAINT "ContactedPlayerStatusEvent_contactedPlayerId_fkey"
  FOREIGN KEY ("contactedPlayerId") REFERENCES "ContactedPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
