ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MANUAL_ADVANCE';

ALTER TABLE "Tournament"
  ADD COLUMN "bracketMessageChannelId" TEXT,
  ADD COLUMN "bracketMessageId" TEXT,
  ADD COLUMN "bracketImageUpdatedAt" TIMESTAMP(3);
