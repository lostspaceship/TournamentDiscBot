ALTER TABLE "Tournament"
  ALTER COLUMN "infoViewTab" SET DEFAULT 'RULES';

UPDATE "Tournament"
SET "infoViewTab" = 'RULES'
WHERE "infoViewTab" IS NULL OR "infoViewTab" = 'PLAYERS';

ALTER TABLE "TournamentSettings"
  ADD COLUMN "rulesBans" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
