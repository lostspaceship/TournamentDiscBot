import {
  AuditAction,
  BracketType,
  MatchStatus,
  Prisma,
  RegistrationStatus,
  SeedingMethod,
  TournamentFormat,
  TournamentStatus
} from "@prisma/client";

import { prisma } from "../config/prisma.js";
import { BracketEngineFactory } from "../domain/bracket/engine.js";
import { seedEntrants } from "../domain/bracket/seeding.js";
import type { BracketSnapshot, SeededEntrant } from "../domain/bracket/types.js";
import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { sanitizeUserText } from "../utils/sanitize.js";

interface CreateTournamentInput {
  guildId: string;
  actorUserId: string;
  name: string;
  description?: string | null;
  format: TournamentFormat;
  maxParticipants: number;
  bestOfDefault: number;
  requireCheckIn?: boolean;
  allowWaitlist?: boolean;
}

interface ConfigTournamentInput {
  guildId: string;
  tournamentId: string;
  actorUserId: string;
  seedingMethod?: SeedingMethod;
  mutualExclusionKey?: string | null;
  requireOpponentConfirmation?: boolean;
  grandFinalResetEnabled?: boolean;
  allowWithdrawals?: boolean;
}

interface SimpleTournamentActionInput {
  guildId: string;
  tournamentId: string;
  actorUserId: string;
}

interface ModerationInput extends SimpleTournamentActionInput {
  targetUserId: string;
  reason: string;
}

export class AdminTournamentService {
  public constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly tournamentRepository: TournamentRepository
  ) {}

  public async createTournament(input: CreateTournamentInput) {
    const guildConfig = await this.guildConfigRepository.getOrCreate(input.guildId);

    const tournament = await prisma.$transaction(async (tx) => {
      const created = await tx.tournament.create({
        data: {
          guildConfigId: guildConfig.id,
          guildId: input.guildId,
          createdByUserId: input.actorUserId,
          name: sanitizeUserText(input.name, 80),
          description: input.description ? sanitizeUserText(input.description, 500) : null,
          format: input.format,
          maxParticipants: input.maxParticipants,
          bestOfDefault: input.bestOfDefault,
          requireCheckIn: input.requireCheckIn ?? false,
          allowWaitlist: input.allowWaitlist ?? true,
          settings: {
            create: {
              seedingMethod: SeedingMethod.RANDOM,
              hasLosersBracket: input.format === TournamentFormat.DOUBLE_ELIMINATION,
              grandFinalResetEnabled: input.format === TournamentFormat.DOUBLE_ELIMINATION
            }
          }
        },
        include: { settings: true }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: created.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_CREATED,
        targetType: "Tournament",
        targetId: created.id
      });

      return created;
    });

    return tournament;
  }

  public async configureTournament(input: ConfigTournamentInput) {
    const tournament = await this.requireTournament(input.tournamentId, input.guildId);
    if (tournament.status !== TournamentStatus.DRAFT) {
      throw new ConflictError("Tournament configuration can only be changed while in draft state.");
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          mutualExclusionKey: input.mutualExclusionKey ?? undefined,
          allowWithdrawals: input.allowWithdrawals ?? undefined,
          settings: {
            update: {
              seedingMethod: input.seedingMethod,
              requireOpponentConfirmation: input.requireOpponentConfirmation,
              grandFinalResetEnabled: input.grandFinalResetEnabled
            }
          }
        },
        include: { settings: true }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_UPDATED,
        targetType: "Tournament",
        targetId: tournament.id
      });

      return updated;
    });
  }

  public async openTournament(input: SimpleTournamentActionInput) {
    const tournament = await this.requireTournament(input.tournamentId, input.guildId);
    if (
      tournament.status !== TournamentStatus.DRAFT &&
      tournament.status !== TournamentStatus.REGISTRATION_CLOSED
    ) {
      throw new ConflictError("Only draft or closed tournaments can open registration.");
    }

    return this.updateTournamentStatus(
      tournament.id,
      input.guildId,
      input.actorUserId,
      TournamentStatus.REGISTRATION_OPEN,
      AuditAction.TOURNAMENT_OPENED
    );
  }

  public async closeTournament(input: SimpleTournamentActionInput) {
    const tournament = await this.requireTournament(input.tournamentId, input.guildId);
    if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
      throw new ConflictError("Registration is not open.");
    }

    const nextStatus = tournament.requireCheckIn
      ? TournamentStatus.CHECK_IN
      : TournamentStatus.REGISTRATION_CLOSED;

    return this.updateTournamentStatus(
      tournament.id,
      input.guildId,
      input.actorUserId,
      nextStatus,
      AuditAction.TOURNAMENT_CLOSED
    );
  }

  public async startTournament(input: SimpleTournamentActionInput) {
    const tournament = await this.requireTournamentWithRelations(input.tournamentId, input.guildId);
    if (
      tournament.status !== TournamentStatus.REGISTRATION_CLOSED &&
      tournament.status !== TournamentStatus.CHECK_IN
    ) {
      throw new ConflictError("Tournament must be closed before it can be started.");
    }

    const activeRegistrations = tournament.registrations.filter(
      (entry) => entry.status === RegistrationStatus.ACTIVE
    );
    const eligibleRegistrations = tournament.requireCheckIn
      ? activeRegistrations.filter((entry) => Boolean(entry.checkIn))
      : activeRegistrations;

    if (eligibleRegistrations.length < 2) {
      throw new ConflictError("At least two eligible participants are required to start.");
    }

    const seededRegistrations = this.seedRegistrations(
      eligibleRegistrations.map((entry) => ({
        registrationId: entry.id,
        participantId: entry.participantId,
        rating: entry.participant.rating,
        joinedAt: entry.joinedAt,
        existingSeed: entry.seed?.seedNumber ?? null
      })),
      tournament.settings?.seedingMethod ?? SeedingMethod.RANDOM
    );

    const engine = BracketEngineFactory.create(
      tournament.format === TournamentFormat.DOUBLE_ELIMINATION
        ? "DOUBLE_ELIMINATION"
        : "SINGLE_ELIMINATION"
    );

    const snapshot = engine.generate({
      entrants: seededRegistrations,
      bestOf: tournament.bestOfDefault,
      grandFinalResetEnabled: tournament.settings?.grandFinalResetEnabled ?? true
    });

    await prisma.$transaction(async (tx) => {
      await tx.seed.deleteMany({ where: { tournamentId: tournament.id } });
      for (const entrant of seededRegistrations) {
        await tx.seed.create({
          data: {
            tournamentId: tournament.id,
            registrationId: entrant.id,
            seedNumber: entrant.seed
          }
        });
      }

      await this.persistBracketSnapshotTx(tx, tournament.id, snapshot);

      await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          status: TournamentStatus.IN_PROGRESS,
          startedAt: new Date()
        }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.BRACKET_GENERATED,
        targetType: "Tournament",
        targetId: tournament.id
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_STARTED,
        targetType: "Tournament",
        targetId: tournament.id
      });
    });
  }

  public async reseedTournament(input: SimpleTournamentActionInput & { method?: SeedingMethod }) {
    const tournament = await this.requireTournamentWithRelations(input.tournamentId, input.guildId);
    if (
      tournament.status !== TournamentStatus.DRAFT &&
      tournament.status !== TournamentStatus.REGISTRATION_OPEN &&
      tournament.status !== TournamentStatus.REGISTRATION_CLOSED &&
      tournament.status !== TournamentStatus.CHECK_IN
    ) {
      throw new ConflictError("Tournament can only be reseeded before it starts.");
    }

    const activeRegistrations = tournament.registrations.filter(
      (entry) => entry.status === RegistrationStatus.ACTIVE
    );
    if (activeRegistrations.length < 2) {
      throw new ConflictError("At least two active registrations are required to reseed.");
    }

    const method = input.method ?? tournament.settings?.seedingMethod ?? SeedingMethod.RANDOM;
    const seededRegistrations = this.seedRegistrations(
      activeRegistrations.map((entry) => ({
        registrationId: entry.id,
        participantId: entry.participantId,
        rating: entry.participant.rating,
        joinedAt: entry.joinedAt,
        existingSeed: entry.seed?.seedNumber ?? null
      })),
      method
    );

    await prisma.$transaction(async (tx) => {
      await tx.seed.deleteMany({ where: { tournamentId: tournament.id } });
      for (const entrant of seededRegistrations) {
        await tx.seed.create({
          data: {
            tournamentId: tournament.id,
            registrationId: entrant.id,
            seedNumber: entrant.seed
          }
        });
      }

      await tx.tournamentSettings.update({
        where: { tournamentId: tournament.id },
        data: {
          seedingMethod: method
        }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.BRACKET_RESEEDED,
        targetType: "Tournament",
        targetId: tournament.id,
        metadataJson: {
          seedingMethod: method
        }
      });
    });
  }

  public async disqualifyParticipant(input: ModerationInput) {
    return this.updateParticipantModeration(input, RegistrationStatus.DISQUALIFIED, AuditAction.PARTICIPANT_DISQUALIFIED);
  }

  public async dropParticipant(input: ModerationInput) {
    return this.updateParticipantModeration(input, RegistrationStatus.DROPPED, AuditAction.PARTICIPANT_DROPPED);
  }

  public async cancelTournament(input: SimpleTournamentActionInput & { reason: string }) {
    const tournament = await this.requireTournament(input.tournamentId, input.guildId);
    if (
      tournament.status === TournamentStatus.CANCELLED ||
      tournament.status === TournamentStatus.FINALIZED ||
      tournament.status === TournamentStatus.ARCHIVED
    ) {
      throw new ConflictError("This tournament can no longer be cancelled.");
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          status: TournamentStatus.CANCELLED
        }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_CANCELLED,
        targetType: "Tournament",
        targetId: tournament.id,
        reason: sanitizeUserText(input.reason)
      });

      return updated;
    });
  }

  public async finalizeTournament(input: SimpleTournamentActionInput) {
    const tournament = await this.requireTournament(input.tournamentId, input.guildId);
    if (
      tournament.status !== TournamentStatus.IN_PROGRESS &&
      tournament.status !== TournamentStatus.PAUSED
    ) {
      throw new ConflictError("Only active tournaments can be finalized.");
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          status: TournamentStatus.FINALIZED,
          completedAt: new Date()
        }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_FINALIZED,
        targetType: "Tournament",
        targetId: tournament.id
      });

      return updated;
    });
  }

  public async getTournamentSettings(input: SimpleTournamentActionInput) {
    const tournament = await this.requireTournamentWithRelations(input.tournamentId, input.guildId);
    return tournament;
  }

  private async updateParticipantModeration(
    input: ModerationInput,
    status: RegistrationStatus,
    action: AuditAction
  ) {
    const tournament = await this.requireTournamentWithRelations(input.tournamentId, input.guildId);
    if (
      tournament.status === TournamentStatus.CANCELLED ||
      tournament.status === TournamentStatus.FINALIZED ||
      tournament.status === TournamentStatus.ARCHIVED
    ) {
      throw new ConflictError("Participants cannot be moderated in this tournament state.");
    }

    const registration = tournament.registrations.find(
      (entry) =>
        entry.participant.discordUserId === input.targetUserId &&
        entry.status === RegistrationStatus.ACTIVE
    );

    if (!registration) {
      throw new NotFoundError("Active participant not found in this tournament.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id: registration.id },
        data:
          status === RegistrationStatus.DROPPED
            ? {
                status,
                dropReason: sanitizeUserText(input.reason)
              }
            : {
                status,
                disqualifiedReason: sanitizeUserText(input.reason)
              }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action,
        targetType: "Registration",
        targetId: registration.id,
        reason: sanitizeUserText(input.reason)
      });
    });
  }

  private seedRegistrations(
    registrations: Array<{
      registrationId: string;
      participantId: string;
      rating: number | null;
      joinedAt: Date;
      existingSeed: number | null;
    }>,
    method: SeedingMethod
  ): Array<SeededEntrant & { id: string }> {
    const entrants = registrations.map((entry) => ({
      id: entry.registrationId,
      seed: entry.existingSeed ?? undefined,
      rating: entry.rating ?? undefined,
      metadata: {
        participantId: entry.participantId,
        joinedAt: entry.joinedAt.toISOString()
      }
    }));

    const seeded = seedEntrants(entrants, {
      method,
      randomSeed: registrations.map((entry) => entry.registrationId).join(":")
    });

    return seeded.map((entry) => ({
      ...entry,
      id: entry.id
    }));
  }

  private async persistBracketSnapshotTx(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    snapshot: BracketSnapshot
  ): Promise<void> {
    await tx.match.deleteMany({ where: { tournamentId } });
    await tx.bracket.deleteMany({ where: { tournamentId } });

    const deferredLinks: Array<{
      id: string;
      nextMatchId: string | null;
      nextMatchSlot: number | null;
      loserNextMatchId: string | null;
      loserNextMatchSlot: number | null;
      resetOfMatchId: string | null;
    }> = [];

    for (const bracketType of [BracketType.WINNERS, BracketType.LOSERS, BracketType.GRAND_FINALS]) {
      const relevantRounds = snapshot.rounds.filter((round) => {
        if (bracketType === BracketType.WINNERS) return round.side === "WINNERS";
        if (bracketType === BracketType.LOSERS) return round.side === "LOSERS";
        return round.side === "GRAND_FINALS";
      });

      if (relevantRounds.length === 0) continue;

      const bracket = await tx.bracket.create({
        data: {
          tournamentId,
          type: bracketType
        }
      });

      for (const round of relevantRounds) {
        const createdRound = await tx.round.create({
          data: {
            bracketId: bracket.id,
            roundNumber: round.roundNumber,
            name: round.name
          }
        });

        for (const matchId of round.matchIds) {
          const match = snapshot.matches[matchId]!;
          await tx.match.create({
            data: {
              id: match.id,
              roundId: createdRound.id,
              tournamentId,
              sequence: match.sequence,
              bracketType: bracketType,
              bestOf: match.bestOf,
              player1RegistrationId: match.slots[0].entrantId,
              player2RegistrationId: match.slots[1].entrantId,
              status:
                match.status === "READY"
                  ? MatchStatus.READY
                  : match.status === "COMPLETED"
                    ? MatchStatus.COMPLETED
                    : match.status === "CANCELLED"
                      ? MatchStatus.CANCELLED
                      : MatchStatus.PENDING,
              winnerRegistrationId: match.winnerId,
              loserRegistrationId: match.loserId,
              completedAt: match.status === "COMPLETED" ? new Date() : null
            }
          });

          deferredLinks.push({
            id: match.id,
            nextMatchId: match.nextMatchId,
            nextMatchSlot: match.nextMatchSlot,
            loserNextMatchId: match.loserNextMatchId,
            loserNextMatchSlot: match.loserNextMatchSlot,
            resetOfMatchId: match.resetOfMatchId
          });
        }
      }
    }

    for (const link of deferredLinks) {
      await tx.match.update({
        where: { id: link.id },
        data: {
          nextMatchId: link.nextMatchId,
          nextMatchSlot: link.nextMatchSlot,
          loserNextMatchId: link.loserNextMatchId,
          loserNextMatchSlot: link.loserNextMatchSlot,
          resetOfMatchId: link.resetOfMatchId
        }
      });
    }
  }

  private async updateTournamentStatus(
    tournamentId: string,
    guildId: string,
    actorUserId: string,
    status: TournamentStatus,
    action: AuditAction
  ) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.tournament.update({
        where: { id: tournamentId },
        data: { status }
      });

      await this.writeAuditLogTx(tx, {
        tournamentId,
        guildId,
        actorUserId,
        action,
        targetType: "Tournament",
        targetId: tournamentId
      });

      return updated;
    });
  }

  private async requireTournament(tournamentId: string, guildId: string) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { settings: true }
    });
    if (!tournament || tournament.guildId !== guildId) {
      throw new NotFoundError("Tournament not found.");
    }
    return tournament;
  }

  private async requireTournamentWithRelations(tournamentId: string, guildId: string) {
    const tournament = await this.tournamentRepository.getTournament(tournamentId);
    if (!tournament || tournament.guildId !== guildId) {
      throw new NotFoundError("Tournament not found.");
    }
    return tournament;
  }

  private async writeAuditLogTx(
    tx: Prisma.TransactionClient,
    args: {
      tournamentId: string;
      guildId: string;
      actorUserId: string;
      action: AuditAction;
      targetType: string;
      targetId: string;
      reason?: string;
      metadataJson?: Prisma.JsonObject;
    }
  ) {
    await tx.auditLog.create({ data: args });
  }
}
