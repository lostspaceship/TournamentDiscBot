-- CreateTable
CREATE TABLE "TournamentPickerWeight" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentPickerWeight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPickerWeight_registrationId_key" ON "TournamentPickerWeight"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPickerWeight_tournamentId_registrationId_key" ON "TournamentPickerWeight"("tournamentId", "registrationId");

-- CreateIndex
CREATE INDEX "TournamentPickerWeight_tournamentId_idx" ON "TournamentPickerWeight"("tournamentId");

-- AddForeignKey
ALTER TABLE "TournamentPickerWeight" ADD CONSTRAINT "TournamentPickerWeight_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPickerWeight" ADD CONSTRAINT "TournamentPickerWeight_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
