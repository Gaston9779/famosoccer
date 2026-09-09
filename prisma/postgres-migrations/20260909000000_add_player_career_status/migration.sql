CREATE TYPE "PlayerCareerStatus" AS ENUM ('ACTIVE', 'FREE_AGENT', 'RETIRED', 'UNKNOWN');

ALTER TABLE "Player"
ADD COLUMN "careerStatus" "PlayerCareerStatus" NOT NULL DEFAULT 'UNKNOWN';
