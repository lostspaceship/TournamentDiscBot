ALTER TABLE "Tournament"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "Match_roundId_sequence_key"
ON "Match"("roundId", "sequence");

CREATE INDEX "Tournament_mutualExclusionKey_idx"
ON "Tournament"("mutualExclusionKey");

CREATE INDEX "ResultReport_tournamentId_createdAt_idx"
ON "ResultReport"("tournamentId", "createdAt");

CREATE INDEX "WaitlistEntry_tournamentId_position_idx"
ON "WaitlistEntry"("tournamentId", "position");
