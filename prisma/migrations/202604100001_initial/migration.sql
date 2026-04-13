CREATE TYPE "StaffRoleType" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'TOURNAMENT_STAFF');
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED', 'CANCELLED', 'FINALIZED', 'ARCHIVED');
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION');
CREATE TYPE "SeedingMethod" AS ENUM ('RANDOM', 'MANUAL', 'RATING_BASED');
CREATE TYPE "ParticipantType" AS ENUM ('SOLO', 'TEAM');
CREATE TYPE "RegistrationStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'DROPPED', 'DISQUALIFIED', 'ELIMINATED', 'WAITLISTED');
CREATE TYPE "BracketType" AS ENUM ('WINNERS', 'LOSERS', 'GRAND_FINALS');
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'READY', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'DISPUTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MatchOutcomeType" AS ENUM ('SCORE', 'NO_SHOW', 'DISQUALIFICATION', 'WALKOVER', 'RESET');
CREATE TYPE "AuditAction" AS ENUM ('TOURNAMENT_CREATED', 'TOURNAMENT_UPDATED', 'TOURNAMENT_OPENED', 'TOURNAMENT_CLOSED', 'TOURNAMENT_STARTED', 'TOURNAMENT_PAUSED', 'TOURNAMENT_RESUMED', 'TOURNAMENT_CANCELLED', 'TOURNAMENT_FINALIZED', 'TOURNAMENT_ARCHIVED', 'PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'PARTICIPANT_CHECKED_IN', 'PARTICIPANT_DROPPED', 'PARTICIPANT_DISQUALIFIED', 'BRACKET_GENERATED', 'BRACKET_RESEEDED', 'RESULT_REPORTED', 'RESULT_CONFIRMED', 'RESULT_DISPUTED', 'RESULT_OVERRIDDEN', 'MATCH_ADVANCED', 'STAFF_OVERRIDE');

CREATE TABLE "GuildConfig" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "adminRoleId" TEXT,
  "modRoleId" TEXT,
  "staffRoleId" TEXT,
  "tournamentAnnouncementChannelId" TEXT,
  "defaultMutualExclusion" BOOLEAN NOT NULL DEFAULT false,
  "defaultCheckInRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffRole" (
  "id" TEXT NOT NULL,
  "guildConfigId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "type" "StaffRoleType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tournament" (
  "id" TEXT NOT NULL,
  "guildConfigId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
  "format" "TournamentFormat" NOT NULL,
  "participantType" "ParticipantType" NOT NULL DEFAULT 'SOLO',
  "maxParticipants" INTEGER NOT NULL,
  "allowWithdrawals" BOOLEAN NOT NULL DEFAULT true,
  "requireCheckIn" BOOLEAN NOT NULL DEFAULT false,
  "allowWaitlist" BOOLEAN NOT NULL DEFAULT true,
  "mutualExclusionKey" TEXT,
  "bestOfDefault" INTEGER NOT NULL DEFAULT 3,
  "startsAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentSettings" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "seedingMethod" "SeedingMethod" NOT NULL DEFAULT 'RANDOM',
  "hasLosersBracket" BOOLEAN NOT NULL DEFAULT false,
  "grandFinalResetEnabled" BOOLEAN NOT NULL DEFAULT true,
  "mutuallyExclusive" BOOLEAN NOT NULL DEFAULT false,
  "checkInOpensMinutesBefore" INTEGER NOT NULL DEFAULT 30,
  "checkInClosesMinutesBefore" INTEGER NOT NULL DEFAULT 5,
  "allowSelfReporting" BOOLEAN NOT NULL DEFAULT true,
  "requireOpponentConfirmation" BOOLEAN NOT NULL DEFAULT true,
  "allowStaffOverrides" BOOLEAN NOT NULL DEFAULT true,
  "allowUndoLastAction" BOOLEAN NOT NULL DEFAULT true,
  "enableRateSeedPlaceholder" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Participant" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "rating" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Registration" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "status" "RegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawnAt" TIMESTAMP(3),
  "dropReason" TEXT,
  "disqualifiedReason" TEXT,
  "placement" INTEGER,
  "registrationKey" TEXT NOT NULL,
  CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Seed" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "seedNumber" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Seed_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bracket" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "type" "BracketType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bracket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Round" (
  "id" TEXT NOT NULL,
  "bracketId" TEXT NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Match" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "bracketType" "BracketType" NOT NULL,
  "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
  "bestOf" INTEGER NOT NULL,
  "player1RegistrationId" TEXT,
  "player2RegistrationId" TEXT,
  "winnerRegistrationId" TEXT,
  "loserRegistrationId" TEXT,
  "nextMatchId" TEXT,
  "nextMatchSlot" INTEGER,
  "loserNextMatchId" TEXT,
  "loserNextMatchSlot" INTEGER,
  "resetOfMatchId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchGame" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "gameNumber" INTEGER NOT NULL,
  "player1Score" INTEGER NOT NULL,
  "player2Score" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResultReport" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "reporterRegistrationId" TEXT,
  "proposedWinnerRegistrationId" TEXT,
  "outcomeType" "MatchOutcomeType" NOT NULL,
  "player1Score" INTEGER,
  "player2Score" INTEGER,
  "status" "MatchStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "reason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "disputedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResultReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" "AuditAction" NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CheckIn" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WaitlistEntry" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");
CREATE UNIQUE INDEX "StaffRole_guildId_roleId_type_key" ON "StaffRole"("guildId", "roleId", "type");
CREATE INDEX "StaffRole_guildConfigId_idx" ON "StaffRole"("guildConfigId");
CREATE INDEX "Tournament_guildId_status_idx" ON "Tournament"("guildId", "status");
CREATE INDEX "Tournament_guildConfigId_idx" ON "Tournament"("guildConfigId");
CREATE UNIQUE INDEX "TournamentSettings_tournamentId_key" ON "TournamentSettings"("tournamentId");
CREATE UNIQUE INDEX "Participant_guildId_discordUserId_key" ON "Participant"("guildId", "discordUserId");
CREATE UNIQUE INDEX "Registration_registrationKey_key" ON "Registration"("registrationKey");
CREATE UNIQUE INDEX "Registration_tournamentId_participantId_key" ON "Registration"("tournamentId", "participantId");
CREATE INDEX "Registration_tournamentId_status_idx" ON "Registration"("tournamentId", "status");
CREATE UNIQUE INDEX "Seed_registrationId_key" ON "Seed"("registrationId");
CREATE UNIQUE INDEX "Seed_tournamentId_seedNumber_key" ON "Seed"("tournamentId", "seedNumber");
CREATE UNIQUE INDEX "Bracket_tournamentId_type_key" ON "Bracket"("tournamentId", "type");
CREATE UNIQUE INDEX "Round_bracketId_roundNumber_key" ON "Round"("bracketId", "roundNumber");
CREATE INDEX "Match_tournamentId_status_idx" ON "Match"("tournamentId", "status");
CREATE INDEX "Match_roundId_sequence_idx" ON "Match"("roundId", "sequence");
CREATE UNIQUE INDEX "MatchGame_matchId_gameNumber_key" ON "MatchGame"("matchId", "gameNumber");
CREATE UNIQUE INDEX "ResultReport_idempotencyKey_key" ON "ResultReport"("idempotencyKey");
CREATE INDEX "ResultReport_matchId_status_idx" ON "ResultReport"("matchId", "status");
CREATE INDEX "AuditLog_tournamentId_createdAt_idx" ON "AuditLog"("tournamentId", "createdAt");
CREATE UNIQUE INDEX "CheckIn_registrationId_key" ON "CheckIn"("registrationId");
CREATE UNIQUE INDEX "CheckIn_tournamentId_participantId_key" ON "CheckIn"("tournamentId", "participantId");
CREATE UNIQUE INDEX "WaitlistEntry_tournamentId_participantId_key" ON "WaitlistEntry"("tournamentId", "participantId");
CREATE UNIQUE INDEX "WaitlistEntry_tournamentId_position_key" ON "WaitlistEntry"("tournamentId", "position");

ALTER TABLE "StaffRole" ADD CONSTRAINT "StaffRole_guildConfigId_fkey" FOREIGN KEY ("guildConfigId") REFERENCES "GuildConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_guildConfigId_fkey" FOREIGN KEY ("guildConfigId") REFERENCES "GuildConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentSettings" ADD CONSTRAINT "TournamentSettings_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Seed" ADD CONSTRAINT "Seed_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Seed" ADD CONSTRAINT "Seed_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bracket" ADD CONSTRAINT "Bracket_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Round" ADD CONSTRAINT "Round_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "Bracket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_nextMatchId_fkey" FOREIGN KEY ("nextMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchGame" ADD CONSTRAINT "MatchGame_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResultReport" ADD CONSTRAINT "ResultReport_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResultReport" ADD CONSTRAINT "ResultReport_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
