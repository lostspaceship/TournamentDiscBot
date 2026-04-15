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
import { TournamentStateMachine } from "../domain/tournament/state-machine.js";
import type {
  TournamentAction as DomainTournamentAction,
  TournamentStateContext,
  TournamentStatus as DomainTournamentStatus
} from "../domain/tournament/types.js";
import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import { buildSeededRegistrations, getEligibleRegistrationsForBracket } from "./support/bracket-snapshot.js";
import type { BracketSyncTarget } from "./support/bracket-sync-target.js";
import { lockTournamentTx, writeAuditLogTx } from "./support/transaction-utils.js";
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

interface ReseedTournamentInput extends SimpleTournamentActionInput {
  method?: SeedingMethod;
  reason: string;
}

type TournamentWithRelations = NonNullable<
  Awaited<ReturnType<TournamentRepository["getTournament"]>>
>;

export class AdminTournamentService {
  private readonly stateMachine = new TournamentStateMachine();

  public constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly tournamentRepository: TournamentRepository,
    private readonly bracketSyncTarget?: BracketSyncTarget
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
          bracketMessageChannelId: guildConfig.tournamentAnnouncementChannelId,
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

      await writeAuditLogTx(tx, {
        tournamentId: created.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_CREATED,
        targetType: "Tournament",
        targetId: created.id
      });

      return created;
    });

    await this.bracketSyncTarget?.syncTournamentBracket(tournament.id);
    return tournament;
  }

  public async configureTournament(input: ConfigTournamentInput) {
    const updated = await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);

      if (tournament.status !== TournamentStatus.DRAFT) {
        throw new ConflictError("Tournament configuration can only be changed while in draft state.");
      }

      const data: Prisma.TournamentUpdateInput = {
        mutualExclusionKey:
          input.mutualExclusionKey === undefined
            ? undefined
            : input.mutualExclusionKey === null
              ? null
              : sanitizeUserText(input.mutualExclusionKey, 50),
        allowWithdrawals: input.allowWithdrawals ?? undefined,
        version: {
          increment: 1
        },
        settings: {
          update: {
            seedingMethod: input.seedingMethod,
            requireOpponentConfirmation: input.requireOpponentConfirmation,
            grandFinalResetEnabled: input.grandFinalResetEnabled
          }
        }
      };

      const updated = await tx.tournament.update({
        where: { id: tournament.id },
        data,
        include: { settings: true }
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_UPDATED,
        targetType: "Tournament",
        targetId: tournament.id
      });

      return updated;
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
    return updated;
  }

  public async openTournament(input: SimpleTournamentActionInput) {
    const result = await this.transitionTournamentStatus({
      guildId: input.guildId,
      tournamentId: input.tournamentId,
      actorUserId: input.actorUserId,
      action: undefined,
      resolveAction: (status) =>
        status === TournamentStatus.REGISTRATION_CLOSED
          ? "REOPEN_REGISTRATION"
          : "OPEN_REGISTRATION",
      auditAction: AuditAction.TOURNAMENT_OPENED
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
    return result;
  }

  public async closeTournament(input: SimpleTournamentActionInput) {
    const result = await this.transitionTournamentStatus({
      guildId: input.guildId,
      tournamentId: input.tournamentId,
      actorUserId: input.actorUserId,
      action: "CLOSE_REGISTRATION",
      auditAction: AuditAction.TOURNAMENT_CLOSED
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
    return result;
  }

  public async startTournament(input: SimpleTournamentActionInput) {
    await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentWithRelationsTx(tx, input.tournamentId, input.guildId);
      const eligibleRegistrations = getEligibleRegistrationsForBracket(tournament);

      if (tournament.brackets.length > 0) {
        throw new ConflictError("A bracket already exists for this tournament.");
      }

      const nextStatus = this.resolveNextStatus(
        tournament.status,
        "START",
        this.buildTransitionContext(tournament, eligibleRegistrations.length)
      );

      const seededRegistrations = buildSeededRegistrations(tournament);

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

      const tournamentUpdateData: Prisma.TournamentUpdateInput = {
        status: nextStatus,
        startedAt: new Date(),
        version: {
          increment: 1
        }
      };

      await tx.tournament.update({
        where: { id: tournament.id },
        data: tournamentUpdateData
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.BRACKET_GENERATED,
        targetType: "Tournament",
        targetId: tournament.id
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.TOURNAMENT_STARTED,
        targetType: "Tournament",
        targetId: tournament.id
      });
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
  }

  public async reseedTournament(input: ReseedTournamentInput) {
    await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentWithRelationsTx(tx, input.tournamentId, input.guildId);

      if (
        tournament.status !== TournamentStatus.DRAFT &&
        tournament.status !== TournamentStatus.REGISTRATION_OPEN &&
        tournament.status !== TournamentStatus.REGISTRATION_CLOSED &&
        tournament.status !== TournamentStatus.CHECK_IN
      ) {
        throw new ConflictError("Tournament can only be reseeded before it starts.");
      }

      if (tournament.brackets.length > 0) {
        throw new ConflictError("The bracket cannot be reseeded after it has been generated.");
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

      const tournamentUpdateData: Prisma.TournamentUpdateInput = {
        version: {
          increment: 1
        }
      };

      await tx.tournament.update({
        where: { id: tournament.id },
        data: tournamentUpdateData
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.BRACKET_RESEEDED,
        targetType: "Tournament",
        targetId: tournament.id,
        reason: sanitizeUserText(input.reason),
        metadataJson: {
          seedingMethod: method
        }
      });
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
  }

  public async disqualifyParticipant(input: ModerationInput) {
    return this.updateParticipantModeration(input, RegistrationStatus.DISQUALIFIED, AuditAction.PARTICIPANT_DISQUALIFIED);
  }

  public async dropParticipant(input: ModerationInput) {
    return this.updateParticipantModeration(input, RegistrationStatus.DROPPED, AuditAction.PARTICIPANT_DROPPED);
  }

  public async cancelTournament(input: SimpleTournamentActionInput & { reason: string }) {
    const result = await this.transitionTournamentStatus({
      guildId: input.guildId,
      tournamentId: input.tournamentId,
      actorUserId: input.actorUserId,
      action: "CANCEL",
      auditAction: AuditAction.TOURNAMENT_CANCELLED,
      reason: sanitizeUserText(input.reason)
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
    return result;
  }

  public async finalizeTournament(input: SimpleTournamentActionInput) {
    const result = await this.transitionTournamentStatus({
      guildId: input.guildId,
      tournamentId: input.tournamentId,
      actorUserId: input.actorUserId,
      action: "FINALIZE",
      auditAction: AuditAction.TOURNAMENT_FINALIZED,
      additionalData: {
        completedAt: new Date()
      }
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
    return result;
  }

  public async getTournamentSettings(input: SimpleTournamentActionInput) {
    const tournament = await this.tournamentRepository.getTournament(input.tournamentId);
    if (!tournament || tournament.guildId !== input.guildId) {
      throw new NotFoundError("Tournament not found.");
    }
    return tournament;
  }

  private async updateParticipantModeration(
    input: ModerationInput,
    status: RegistrationStatus,
    action: AuditAction
  ) {
    await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentWithRelationsTx(tx, input.tournamentId, input.guildId);

      if (
        tournament.status === TournamentStatus.CANCELLED ||
        tournament.status === TournamentStatus.FINALIZED ||
        tournament.status === TournamentStatus.ARCHIVED
      ) {
        throw new ConflictError("Participants cannot be moderated in this tournament state.");
      }

      if (
        tournament.status === TournamentStatus.IN_PROGRESS ||
        tournament.status === TournamentStatus.PAUSED
      ) {
        throw new ConflictError(
          "Participant moderation is blocked after the bracket starts until a bracket-aware moderation flow is implemented."
        );
      }

      const registration = tournament.registrations.find(
        (entry) =>
          entry.participant.discordUserId === input.targetUserId &&
          entry.status === RegistrationStatus.ACTIVE
      );

      if (!registration) {
        throw new NotFoundError("Active participant not found in this tournament.");
      }

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

      const tournamentUpdateData: Prisma.TournamentUpdateInput = {
        version: {
          increment: 1
        }
      };

      await tx.tournament.update({
        where: { id: tournament.id },
        data: tournamentUpdateData
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action,
        targetType: "Registration",
        targetId: registration.id,
        reason: sanitizeUserText(input.reason)
      });
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
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

  private async transitionTournamentStatus(args: {
    guildId: string;
    tournamentId: string;
    actorUserId: string;
    action?: DomainTournamentAction;
    resolveAction?: (status: TournamentStatus) => DomainTournamentAction;
    auditAction: AuditAction;
    reason?: string;
    additionalData?: Prisma.TournamentUpdateInput;
  }) {
    return prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, args.tournamentId);
      const tournament = await this.loadTournamentTx(tx, args.tournamentId, args.guildId);
      const action =
        args.action ?? args.resolveAction?.(tournament.status);

      if (!action) {
        throw new ConflictError("No lifecycle action could be resolved for this tournament state.");
      }

      const nextStatus = this.resolveNextStatus(
        tournament.status,
        action,
        this.buildTransitionContext(tournament, 0)
      );

      const data: Prisma.TournamentUpdateInput = {
        status: nextStatus,
        version: {
          increment: 1
        },
        ...args.additionalData
      };

      const updated = await tx.tournament.update({
        where: { id: tournament.id },
        data
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: args.guildId,
        actorUserId: args.actorUserId,
        action: args.auditAction,
        targetType: "Tournament",
        targetId: tournament.id,
        reason: args.reason
      });

      return updated;
    });
  }

  private buildTransitionContext(
    tournament: {
      requireCheckIn: boolean;
      brackets: Array<{ id: string }>;
    },
    eligibleParticipantCount: number
  ): TournamentStateContext {
    return {
      requireCheckIn: tournament.requireCheckIn,
      eligibleParticipantCount,
      bracketGenerated: tournament.brackets.length > 0,
      canReopenRegistration: true
    };
  }

  private resolveNextStatus(
    current: TournamentStatus,
    action: DomainTournamentAction,
    context: TournamentStateContext
  ): TournamentStatus {
    return this.stateMachine.transition(
      current as DomainTournamentStatus,
      action,
      context
    ).to as TournamentStatus;
  }

  private async loadTournamentTx(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    guildId: string
  ) {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        settings: true,
        brackets: {
          select: { id: true }
        }
      }
    });

    if (!tournament || tournament.guildId !== guildId) {
      throw new NotFoundError("Tournament not found.");
    }

    return tournament;
  }

  private async loadTournamentWithRelationsTx(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    guildId: string
  ): Promise<TournamentWithRelations> {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        settings: true,
        registrations: {
          include: { participant: true, seed: true, checkIn: true },
          orderBy: [{ seed: { seedNumber: "asc" } }, { joinedAt: "asc" }]
        },
        brackets: {
          include: {
            rounds: {
              include: {
                matches: {
                  include: { reports: true, games: true },
                  orderBy: { sequence: "asc" }
                }
              },
              orderBy: { roundNumber: "asc" }
            }
          }
        },
        waitlistEntries: {
          include: { participant: true },
          orderBy: { position: "asc" }
        },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 50
        }
      }
    });

    if (!tournament || tournament.guildId !== guildId) {
      throw new NotFoundError("Tournament not found.");
    }

    return tournament;
  }
}
