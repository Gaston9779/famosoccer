CREATE TYPE "PreferredFoot" AS ENUM ('RIGHT', 'LEFT', 'BOTH', 'UNKNOWN');

ALTER TABLE "Player"
  ALTER COLUMN "preferredFoot" DROP DEFAULT,
  ALTER COLUMN "preferredFoot" TYPE "PreferredFoot"
  USING (
    CASE lower(trim(coalesce("preferredFoot", '')))
      WHEN 'right' THEN 'RIGHT'
      WHEN 'right foot' THEN 'RIGHT'
      WHEN 'rechts' THEN 'RIGHT'
      WHEN 'destro' THEN 'RIGHT'
      WHEN 'piede destro' THEN 'RIGHT'
      WHEN 'left' THEN 'LEFT'
      WHEN 'left foot' THEN 'LEFT'
      WHEN 'links' THEN 'LEFT'
      WHEN 'sinistro' THEN 'LEFT'
      WHEN 'piede sinistro' THEN 'LEFT'
      WHEN 'both' THEN 'BOTH'
      WHEN 'both feet' THEN 'BOTH'
      WHEN 'ambidextrous' THEN 'BOTH'
      WHEN 'two-footed' THEN 'BOTH'
      WHEN 'beidfußig' THEN 'BOTH'
      WHEN 'beidfussig' THEN 'BOTH'
      WHEN 'entrambi' THEN 'BOTH'
      WHEN 'ambidestro' THEN 'BOTH'
      ELSE 'UNKNOWN'
    END::"PreferredFoot"
  ),
  ALTER COLUMN "preferredFoot" SET DEFAULT 'UNKNOWN',
  ALTER COLUMN "preferredFoot" SET NOT NULL;

ALTER TABLE "Player" ADD COLUMN "preferredFootSyncedAt" TIMESTAMP(3);
