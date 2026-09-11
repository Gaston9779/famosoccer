CREATE TABLE "PlayerPool" (
  "playerId" TEXT NOT NULL,
  "poolKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerPool_pkey" PRIMARY KEY ("playerId", "poolKey")
);
CREATE INDEX "PlayerPool_poolKey_idx" ON "PlayerPool"("poolKey");
ALTER TABLE "PlayerPool" ADD CONSTRAINT "PlayerPool_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
