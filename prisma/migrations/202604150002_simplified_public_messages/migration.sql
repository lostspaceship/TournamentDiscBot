ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MANUAL_ADVANCE_UNDONE';

ALTER TABLE "Tournament"
  ADD COLUMN "gameTitle" TEXT,
  ADD COLUMN "infoMessageChannelId" TEXT,
  ADD COLUMN "infoMessageId" TEXT;

UPDATE "Tournament"
SET
  "requireCheckIn" = FALSE,
  "allowWaitlist" = FALSE,
  "infoMessageChannelId" = COALESCE("infoMessageChannelId", "bracketMessageChannelId");
