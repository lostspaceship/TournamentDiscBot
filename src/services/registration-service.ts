import crypto from "node:crypto";

import {
  AuditAction,
  Prisma,
  RegistrationStatus,
  TournamentStatus
} from "@prisma/client";

import { prisma } from "../config/prisma.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import {
  lockTournamentTx,
  mapUniqueConstraintError,
  writeAuditLogTx
} from "./support/transaction-utils.js";
import type { BracketSyncTarget } from "./support/bracket-sync-target.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { sanitizeUserText } from "../utils/sanitize.js";

interface JoinTournamentInput {
  guildId: string;
  tournamentId: string;
  actorUserId: string;
  displayName: string;
  opggProfile: string;
}

interface LeaveTournamentInput {
  guildId: string;
  tournamentId: string;
  actorUserId: string;
}

interface CheckInTournamentInput {
  guildId: string;
  tournamentId: string;
  actorUserId: string;
}

interface AddFakePlayersInput {
  guildId: string;
  tournamentId: string;
  actorUserId: string;
  count: number;
  prefix?: string;
}

export interface JoinTournamentResult {
  registrationId?: string;
  waitlisted: boolean;
  waitlistPosition?: number;
}

export class RegistrationService {
  public constructor(
    private readonly tournamentRepository: TournamentRepository,
    private readonly bracketSyncTarget?: BracketSyncTarget
  ) {}

  public async joinTournament(input: JoinTournamentInput): Promise<JoinTournamentResult> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockTournamentTx(tx, input.tournamentId);

        const tournament = await tx.tournament.findUnique({
          where: { id: input.tournamentId },
          include: {
            settings: true,
            registrations: {
              include: { participant: true }
            },
            waitlistEntries: {
              include: { participant: true },
              orderBy: { position: "asc" }
            }
          }
        });

        if (!tournament || tournament.guildId !== input.guildId) {
          throw new NotFoundError("Tournament not found.");
        }

        if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
          throw new ConflictError("This tournament is not currently accepting registrations.");
        }

        const participant = await tx.participant.upsert({
          where: {
            guildId_discordUserId: {
              guildId: input.guildId,
              discordUserId: input.actorUserId
            }
          },
          update: {
            displayName: sanitizeUserText(input.displayName, 80),
            opggProfile: sanitizeUserText(input.opggProfile, 120)
          },
          create: {
            guildId: input.guildId,
            discordUserId: input.actorUserId,
            displayName: sanitizeUserText(input.displayName, 80),
            opggProfile: sanitizeUserText(input.opggProfile, 120)
          }
        });

        const duplicateRegistration = tournament.registrations.find(
          (entry) =>
            entry.participantId === participant.id &&
            (entry.status === RegistrationStatus.ACTIVE ||
              entry.status === RegistrationStatus.WAITLISTED)
        );
        if (duplicateRegistration) {
          throw new ConflictError("You are already registered for this tournament.");
        }

        const duplicateWaitlist = tournament.waitlistEntries.find(
          (entry) => entry.participantId === participant.id
        );
        if (duplicateWaitlist) {
          throw new ConflictError("You are already on the waitlist for this tournament.");
        }

        if (tournament.mutualExclusionKey) {
          const conflicting = await tx.registration.findFirst({
            where: {
              participantId: participant.id,
              tournamentId: { not: tournament.id },
              status: RegistrationStatus.ACTIVE,
              tournament: {
                guildId: input.guildId,
                mutualExclusionKey: tournament.mutualExclusionKey,
                status: {
                  in: [
                    TournamentStatus.REGISTRATION_OPEN,
                    TournamentStatus.REGISTRATION_CLOSED,
                    TournamentStatus.CHECK_IN,
                    TournamentStatus.IN_PROGRESS,
                    TournamentStatus.PAUSED
                  ]
                }
              }
            }
          });

          if (conflicting) {
            throw new ConflictError("You are already entered in a mutually exclusive tournament.");
          }
        }

        const activeCount = tournament.registrations.filter(
          (entry) => entry.status === RegistrationStatus.ACTIVE
        ).length;
        const isFull = activeCount >= tournament.maxParticipants;

        if (isFull) {
          if (!tournament.allowWaitlist) {
            throw new ConflictError("This tournament is full.");
          }

          const waitlistEntry = await tx.waitlistEntry.create({
            data: {
              tournamentId: tournament.id,
              participantId: participant.id,
              position: tournament.waitlistEntries.length + 1
            }
          });

          await writeAuditLogTx(tx, {
            tournamentId: tournament.id,
            guildId: input.guildId,
            actorUserId: input.actorUserId,
            action: AuditAction.PARTICIPANT_JOINED,
            targetType: "WaitlistEntry",
            targetId: waitlistEntry.id,
            metadataJson: {
              mode: "WAITLIST",
              position: waitlistEntry.position
            }
          });

          return {
            waitlisted: true,
            waitlistPosition: waitlistEntry.position
          };
        }

        const registration = await tx.registration.create({
          data: {
            tournamentId: tournament.id,
            participantId: participant.id,
            registrationKey: crypto
              .createHash("sha256")
              .update(`${tournament.id}:${participant.id}`)
              .digest("hex")
          }
        });

        await writeAuditLogTx(tx, {
          tournamentId: tournament.id,
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          action: AuditAction.PARTICIPANT_JOINED,
          targetType: "Registration",
          targetId: registration.id,
          metadataJson: {
            mode: "ACTIVE",
            opggProfile: sanitizeUserText(input.opggProfile, 120)
          }
        });

        return {
          registrationId: registration.id,
          waitlisted: false
        };
      });
      await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
      return result;
    } catch (error) {
      throw mapUniqueConstraintError(error, "You are already registered for this tournament.");
    }
  }

  public async leaveTournament(input: LeaveTournamentInput): Promise<{ leftWaitlist: boolean }> {
    const result = await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);

      const tournament = await tx.tournament.findUnique({
        where: { id: input.tournamentId },
        include: {
          registrations: {
            include: { participant: true }
          },
          waitlistEntries: {
            include: { participant: true },
            orderBy: { position: "asc" }
          }
        }
      });

      if (!tournament || tournament.guildId !== input.guildId) {
        throw new NotFoundError("Tournament not found.");
      }

      const waitlistEntry = tournament.waitlistEntries.find(
        (entry) => entry.participant.discordUserId === input.actorUserId
      );
      if (waitlistEntry) {
        await tx.waitlistEntry.delete({
          where: { id: waitlistEntry.id }
        });

        const remaining = await tx.waitlistEntry.findMany({
          where: { tournamentId: tournament.id },
          orderBy: { position: "asc" }
        });

        for (let index = 0; index < remaining.length; index += 1) {
          const entry = remaining[index]!;
          if (entry.position !== index + 1) {
            await tx.waitlistEntry.update({
              where: { id: entry.id },
              data: { position: index + 1 }
            });
          }
        }

        await writeAuditLogTx(tx, {
          tournamentId: tournament.id,
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          action: AuditAction.PARTICIPANT_LEFT,
          targetType: "WaitlistEntry",
          targetId: waitlistEntry.id,
          metadataJson: { mode: "WAITLIST" }
        });

        return { leftWaitlist: true };
      }

      const registration = tournament.registrations.find(
        (entry) =>
          entry.participant.discordUserId === input.actorUserId &&
          entry.status === RegistrationStatus.ACTIVE
      );

      if (!registration) {
        throw new NotFoundError("You are not registered for this tournament.");
      }

      if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
        throw new ConflictError("You can only leave while registration is open.");
      }

      if (!tournament.allowWithdrawals) {
        throw new ConflictError("Leaving this tournament is disabled.");
      }

      await tx.registration.update({
        where: { id: registration.id },
        data: {
          status: RegistrationStatus.WITHDRAWN,
          withdrawnAt: new Date()
        }
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.PARTICIPANT_LEFT,
        targetType: "Registration",
        targetId: registration.id,
        metadataJson: { mode: "ACTIVE" }
      });

      return { leftWaitlist: false };
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
    return result;
  }

  public async checkIn(input: CheckInTournamentInput): Promise<{ registrationId: string }> {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockTournamentTx(tx, input.tournamentId);

        const tournament = await tx.tournament.findUnique({
          where: { id: input.tournamentId },
          include: {
            registrations: {
              include: { participant: true, checkIn: true }
            }
          }
        });

        if (!tournament || tournament.guildId !== input.guildId) {
          throw new NotFoundError("Tournament not found.");
        }

        if (tournament.status !== TournamentStatus.CHECK_IN) {
          throw new ConflictError("Check-in is not currently open for this tournament.");
        }

        const registration = tournament.registrations.find(
          (entry) =>
            entry.participant.discordUserId === input.actorUserId &&
            entry.status === RegistrationStatus.ACTIVE
        );

        if (!registration) {
          throw new NotFoundError("You are not an active participant in this tournament.");
        }

        if (registration.checkIn) {
          throw new ConflictError("You have already checked in.");
        }

        await tx.checkIn.create({
          data: {
            tournamentId: tournament.id,
            registrationId: registration.id,
            participantId: registration.participantId
          }
        });

        await writeAuditLogTx(tx, {
          tournamentId: tournament.id,
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          action: AuditAction.PARTICIPANT_CHECKED_IN,
          targetType: "Registration",
          targetId: registration.id
        });

        return { registrationId: registration.id };
      });
    } catch (error) {
      throw mapUniqueConstraintError(error, "You have already checked in.");
    }
  }

  public async addFakePlayers(
    input: AddFakePlayersInput
  ): Promise<{ addedCount: number; names: string[] }> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockTournamentTx(tx, input.tournamentId);

        const tournament = await tx.tournament.findUnique({
          where: { id: input.tournamentId },
          include: {
            registrations: {
              include: { participant: true }
            }
          }
        });

        if (!tournament || tournament.guildId !== input.guildId) {
          throw new NotFoundError("Tournament not found.");
        }

        if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
          throw new ConflictError("Fake players can only be added while registration is open.");
        }

        const activeCount = tournament.registrations.filter(
          (entry) => entry.status === RegistrationStatus.ACTIVE
        ).length;
        const remainingSlots = tournament.maxParticipants - activeCount;
        if (input.count > remainingSlots) {
          throw new ConflictError(
            `Only ${remainingSlots} registration slot${remainingSlots === 1 ? "" : "s"} remain in this tournament.`
          );
        }

        const fakePrefix = `fake:${tournament.id}:`;
        const nextFakeIndex =
          tournament.registrations.reduce((highest, entry) => {
            if (!entry.participant.discordUserId.startsWith(fakePrefix)) {
              return highest;
            }

            const parsed = Number(entry.participant.discordUserId.slice(fakePrefix.length));
            return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest;
          }, 0) + 1;

        const baseName = sanitizeUserText(input.prefix ?? "Test Player", 40);
        const createdNames: string[] = [];

        for (let index = 0; index < input.count; index += 1) {
          const fakeNumber = nextFakeIndex + index;
          const displayName = sanitizeUserText(`${baseName} ${fakeNumber}`, 80);
          const leagueTag = `${baseName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "Test"}${fakeNumber}#BOT`;
          const discordUserId = `${fakePrefix}${fakeNumber}`;

          const participant = await tx.participant.upsert({
            where: {
              guildId_discordUserId: {
                guildId: input.guildId,
                discordUserId
              }
            },
            update: {
              displayName,
              opggProfile: leagueTag
            },
            create: {
              guildId: input.guildId,
              discordUserId,
              displayName,
              opggProfile: leagueTag
            }
          });

          const registration = await tx.registration.create({
            data: {
              tournamentId: tournament.id,
              participantId: participant.id,
              registrationKey: crypto
                .createHash("sha256")
                .update(`${tournament.id}:${participant.id}`)
                .digest("hex")
            }
          });

          await writeAuditLogTx(tx, {
            tournamentId: tournament.id,
            guildId: input.guildId,
            actorUserId: input.actorUserId,
            action: AuditAction.PARTICIPANT_JOINED,
            targetType: "Registration",
            targetId: registration.id,
            metadataJson: {
              mode: "ACTIVE",
              fakeParticipant: true,
              displayName,
              opggProfile: leagueTag
            }
          });

          createdNames.push(displayName);
        }

        return {
          addedCount: createdNames.length,
          names: createdNames
        };
      });

      await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
      return result;
    } catch (error) {
      throw mapUniqueConstraintError(error, "One or more fake players were already added.");
    }
  }
}
