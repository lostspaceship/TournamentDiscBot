import {
  AuditAction,
  MatchOutcomeType,
  MatchStatus,
  Prisma,
  RegistrationStatus,
  TournamentStatus
} from "@prisma/client";

import { prisma } from "../config/prisma.js";
import { BracketEngineFactory } from "../domain/bracket/engine.js";
import type {
  BracketSnapshot,
  MatchNode,
  ReportMatchOutcomeInput
} from "../domain/bracket/types.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import {
  buildPersistedSnapshotFromTournament,
  type TournamentWithBracketData
} from "./support/bracket-snapshot.js";
import type { BracketSyncTarget } from "./support/bracket-sync-target.js";
import {
  lockMatchTx,
  lockTournamentTx,
  mapUniqueConstraintError,
  type TransactionClient,
  writeAuditLogTx
} from "./support/transaction-utils.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { sanitizeUserText } from "../utils/sanitize.js";

interface MatchActionInput {
  guildId: string;
  tournamentId: string;
  actorUserId: string;
}

interface ViewMatchInput extends MatchActionInput {
  matchId?: string;
}

interface ReportResultInput extends MatchActionInput {
  matchId: string;
  winnerRegistrationId: string;
  loserRegistrationId: string;
  outcomeType: MatchOutcomeType;
  winnerScore?: number | null;
  loserScore?: number | null;
  reason?: string | null;
  idempotencyKey: string;
}

interface ConfirmResultInput extends MatchActionInput {
  reportId: string;
}

interface DisputeResultInput extends MatchActionInput {
  reportId: string;
  reason: string;
}

interface OverrideResultInput extends ReportResultInput {
  reason: string;
}

interface ManualAdvanceInput extends MatchActionInput {
  matchId: string;
  winnerRegistrationId: string;
  reason: string;
  idempotencyKey: string;
}

interface ManualAdvanceSelectionInput extends MatchActionInput {
  targetUserId?: string;
  targetPlayerName?: string;
  reason?: string;
  idempotencyKey: string;
}

interface UndoManualAdvanceInput extends MatchActionInput {
  reportId: string;
}

type TournamentWithRelations = TournamentWithBracketData;
type PersistedReport = {
  id: string;
  matchId: string;
  proposedWinnerRegistrationId: string | null;
  reason: string | null;
};

const bracketMutationAuditActions = [
  AuditAction.RESULT_CONFIRMED,
  AuditAction.RESULT_OVERRIDDEN,
  AuditAction.MATCH_ADVANCED,
  AuditAction.MANUAL_ADVANCE,
  AuditAction.MANUAL_ADVANCE_UNDONE,
  AuditAction.TOURNAMENT_FINALIZED
] as const;

export class MatchReportingService {
  public constructor(
    private readonly tournamentRepository: TournamentRepository,
    private readonly bracketSyncTarget?: BracketSyncTarget
  ) {}

  public async getMatchView(input: ViewMatchInput) {
    const tournament = await this.requireTournamentWithRelations(input.tournamentId, input.guildId);
    const actorRegistration = this.findActorRegistration(tournament, input.actorUserId, false);

    let match =
      input.matchId != null
        ? tournament.brackets
            .flatMap((bracket) => bracket.rounds)
            .flatMap((round) => round.matches)
            .find((entry) => entry.id === input.matchId)
        : tournament.brackets
            .flatMap((bracket) => bracket.rounds)
            .flatMap((round) => round.matches)
            .find(
              (entry) =>
                entry.status !== MatchStatus.COMPLETED &&
                entry.status !== MatchStatus.CANCELLED &&
                (entry.player1RegistrationId === actorRegistration?.id ||
                  entry.player2RegistrationId === actorRegistration?.id)
            );

    if (!match) {
      throw new NotFoundError(
        input.matchId
          ? "Match not found for this tournament."
          : "No active match was found for your registration."
      );
    }

    const player1 = tournament.registrations.find((entry) => entry.id === match.player1RegistrationId);
    const player2 = tournament.registrations.find((entry) => entry.id === match.player2RegistrationId);
    const latestReport = [...match.reports].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    )[0];

    return {
      tournamentName: tournament.name,
      matchId: match.id,
      status: match.status,
      bracketType: match.bracketType,
      sequence: match.sequence,
      bestOf: match.bestOf,
      player1: player1?.participant.displayName ?? "TBD",
      player2: player2?.participant.displayName ?? "TBD",
      latestReport:
        latestReport == null
          ? null
          : {
              id: latestReport.id,
              status: latestReport.status,
              outcomeType: latestReport.outcomeType,
              winnerRegistrationId: latestReport.proposedWinnerRegistrationId,
              player1Score: latestReport.player1Score,
              player2Score: latestReport.player2Score,
              reason: latestReport.reason
            }
    };
  }

  public async reportResult(input: ReportResultInput) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockTournamentTx(tx, input.tournamentId);
        await lockMatchTx(tx, input.matchId);

        const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);
        const actorRegistration = this.findActorRegistration(tournament, input.actorUserId, true);
        const match = this.requireMatchRecord(tournament, input.matchId);

        this.validateTournamentIsActive(tournament);
        this.validateMatchReportable(match);
        this.validateActorAssignedToMatch(match, actorRegistration.id);
        this.validateEntrantsForMatch(match, input.winnerRegistrationId, input.loserRegistrationId);
        this.validateOutcomeAndScores(match.bestOf, input);
        this.ensureNoPendingReport(match);

        const createdReport = await tx.resultReport.create({
          data: {
            tournamentId: tournament.id,
            matchId: match.id,
            submittedByUserId: input.actorUserId,
            reporterRegistrationId: actorRegistration.id,
            proposedWinnerRegistrationId: input.winnerRegistrationId,
            outcomeType: input.outcomeType,
            player1Score: this.scoreForPlayerSlot(match, input, 1),
            player2Score: this.scoreForPlayerSlot(match, input, 2),
            status: MatchStatus.AWAITING_CONFIRMATION,
            reason: input.reason ? sanitizeUserText(input.reason) : null,
            idempotencyKey: input.idempotencyKey
          }
        });

        const updatedMatch = await tx.match.updateMany({
          where: {
            id: match.id,
            version: match.version,
            status: { in: [MatchStatus.READY, MatchStatus.DISPUTED] }
          },
          data: {
            status: MatchStatus.AWAITING_CONFIRMATION,
            version: { increment: 1 }
          }
        });

        if (updatedMatch.count !== 1) {
          throw new ConflictError("This match changed while your report was being submitted.");
        }

        await writeAuditLogTx(tx, {
          tournamentId: tournament.id,
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          action: AuditAction.RESULT_REPORTED,
          targetType: "ResultReport",
          targetId: createdReport.id,
          reason: input.reason ? sanitizeUserText(input.reason) : undefined,
          metadataJson: {
            matchId: match.id,
            outcomeType: input.outcomeType,
            winnerRegistrationId: input.winnerRegistrationId,
            loserRegistrationId: input.loserRegistrationId
          }
        });

        return {
          reportId: createdReport.id,
          matchId: match.id
        };
      });
    } catch (error) {
      throw mapUniqueConstraintError(error, "This result report was already processed.");
    }
  }

  public async confirmResult(input: ConfirmResultInput) {
    const result = await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);
      const actorRegistration = this.findActorRegistration(tournament, input.actorUserId, true);
      const report = this.requireReport(tournament, input.reportId);
      await lockMatchTx(tx, report.matchId);
      const match = this.requireMatchRecord(tournament, report.matchId);

      this.validateTournamentIsActive(tournament);
      if (report.status !== MatchStatus.AWAITING_CONFIRMATION) {
        throw new ConflictError("This result report is no longer awaiting confirmation.");
      }

      const reporterRegistrationId = report.reporterRegistrationId;
      if (!reporterRegistrationId) {
        throw new ConflictError("This result report is missing its reporter registration.");
      }

      const assignedRegistrations = [match.player1RegistrationId, match.player2RegistrationId].filter(
        (entry): entry is string => entry != null
      );

      if (!assignedRegistrations.includes(actorRegistration.id)) {
        throw new ValidationError("You are not assigned to this match.");
      }

      if (actorRegistration.id === reporterRegistrationId) {
        throw new ConflictError("The reporting player cannot confirm their own result.");
      }

      const reportUpdate = await tx.resultReport.updateMany({
        where: {
          id: report.id,
          status: MatchStatus.AWAITING_CONFIRMATION
        },
        data: {
          status: MatchStatus.CONFIRMED,
          confirmedByUserId: input.actorUserId
        }
      });

      if (reportUpdate.count !== 1) {
        throw new ConflictError("This result was already handled.");
      }

      return this.applyConfirmedOutcomeTx(tx, tournament, match, report, {
        actorUserId: input.actorUserId,
        auditAction: AuditAction.RESULT_CONFIRMED,
        auditReason: report.reason ?? undefined
      });
    });
    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
    return result;
  }

  public async disputeResult(input: DisputeResultInput) {
    return prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);
      const actorRegistration = this.findActorRegistration(tournament, input.actorUserId, true);
      const report = this.requireReport(tournament, input.reportId);
      await lockMatchTx(tx, report.matchId);
      const match = this.requireMatchRecord(tournament, report.matchId);

      this.validateTournamentIsActive(tournament);
      if (report.status !== MatchStatus.AWAITING_CONFIRMATION) {
        throw new ConflictError("This result report is no longer awaiting confirmation.");
      }

      const assignedRegistrations = [match.player1RegistrationId, match.player2RegistrationId].filter(
        (entry): entry is string => entry != null
      );

      if (!assignedRegistrations.includes(actorRegistration.id)) {
        throw new ValidationError("You are not assigned to this match.");
      }

      if (actorRegistration.id === report.reporterRegistrationId) {
        throw new ConflictError("The reporting player cannot dispute their own result.");
      }

      const reportUpdate = await tx.resultReport.updateMany({
        where: {
          id: report.id,
          status: MatchStatus.AWAITING_CONFIRMATION
        },
        data: {
          status: MatchStatus.DISPUTED,
          disputedByUserId: input.actorUserId,
          reason: sanitizeUserText(input.reason)
        }
      });

      if (reportUpdate.count !== 1) {
        throw new ConflictError("This result was already handled.");
      }

      const matchUpdate = await tx.match.updateMany({
        where: {
          id: match.id,
          version: match.version,
          status: MatchStatus.AWAITING_CONFIRMATION
        },
        data: {
          status: MatchStatus.DISPUTED,
          version: { increment: 1 }
        }
      });

      if (matchUpdate.count !== 1) {
        throw new ConflictError("This match changed while the dispute was being recorded.");
      }

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.RESULT_DISPUTED,
        targetType: "ResultReport",
        targetId: report.id,
        reason: sanitizeUserText(input.reason),
        metadataJson: {
          matchId: match.id
        }
      });

      return {
        reportId: report.id,
        matchId: match.id
      };
    });
  }

  public async overrideResult(input: OverrideResultInput) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockTournamentTx(tx, input.tournamentId);
        await lockMatchTx(tx, input.matchId);

        const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);
        const match = this.requireMatchRecord(tournament, input.matchId);

        this.validateTournamentIsActive(tournament);
        this.validateMatchReportableOrAwaiting(match);
        this.validateEntrantsForMatch(match, input.winnerRegistrationId, input.loserRegistrationId);
        this.validateOutcomeAndScores(match.bestOf, input);

        const createdReport = await tx.resultReport.create({
          data: {
            tournamentId: tournament.id,
            matchId: match.id,
            submittedByUserId: input.actorUserId,
            reporterRegistrationId: null,
            proposedWinnerRegistrationId: input.winnerRegistrationId,
            outcomeType: input.outcomeType,
            player1Score: this.scoreForPlayerSlot(match, input, 1),
            player2Score: this.scoreForPlayerSlot(match, input, 2),
            status: MatchStatus.CONFIRMED,
            reason: sanitizeUserText(input.reason),
            confirmedByUserId: input.actorUserId,
            idempotencyKey: input.idempotencyKey
          }
        });

        return this.applyConfirmedOutcomeTx(tx, tournament, match, createdReport, {
          actorUserId: input.actorUserId,
          auditAction: AuditAction.RESULT_OVERRIDDEN,
          auditReason: sanitizeUserText(input.reason)
        });
      });
      await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
      return result;
    } catch (error) {
      throw mapUniqueConstraintError(error, "This override was already processed.");
    }
  }

  public async manualAdvance(input: ManualAdvanceInput) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockTournamentTx(tx, input.tournamentId);
        await lockMatchTx(tx, input.matchId);

        const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);
        const match = this.requireMatchRecord(tournament, input.matchId);
        return this.applyManualAdvanceTx(tx, tournament, match, input.winnerRegistrationId, {
          actorUserId: input.actorUserId,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey
        });
      });
      await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
      return result;
    } catch (error) {
      throw mapUniqueConstraintError(error, "That advance was already processed.");
    }
  }

  public async manualAdvanceBySelection(input: ManualAdvanceSelectionInput) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockTournamentTx(tx, input.tournamentId);
        const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);

        if (tournament.brackets.length === 0) {
          throw new ConflictError("The bracket is not locked yet. Run /tour start first.");
        }

        this.validateTournamentIsActive(tournament);

        const targetRegistration = this.findRegistrationForManualAdvance(tournament, input);
        const candidateMatches = tournament.brackets
          .flatMap((bracket) => bracket.rounds)
          .flatMap((round) => round.matches)
          .filter(
            (match) =>
              (match.status === MatchStatus.READY || match.status === MatchStatus.DISPUTED) &&
              (match.player1RegistrationId === targetRegistration.id ||
                match.player2RegistrationId === targetRegistration.id)
          );

        if (candidateMatches.length === 0) {
          throw new NotFoundError("No active match was found for that player.");
        }

        if (candidateMatches.length > 1) {
          throw new ConflictError("That player is assigned to multiple active matches. Use a more specific flow.");
        }

        const match = candidateMatches[0]!;
        await lockMatchTx(tx, match.id);

        return this.applyManualAdvanceTx(tx, tournament, match, targetRegistration.id, {
          actorUserId: input.actorUserId,
          reason:
            input.reason ??
            `Manual staff advance for ${targetRegistration.participant.displayName}`,
          idempotencyKey: input.idempotencyKey
        });
      });
      await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
      return result;
    } catch (error) {
      throw mapUniqueConstraintError(error, "That advance was already processed.");
    }
  }

  public async undoManualAdvance(input: UndoManualAdvanceInput) {
    await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);

      const report = await tx.resultReport.findFirst({
        where: {
          id: input.reportId,
          tournamentId: tournament.id
        }
      });
      if (!report) {
        throw new NotFoundError("Manual advance report not found for this tournament.");
      }

      const auditLog = await tx.auditLog.findFirst({
        where: {
          tournamentId: tournament.id,
          action: AuditAction.MANUAL_ADVANCE,
          targetId: report.id
        },
        orderBy: { createdAt: "desc" }
      });

      if (!auditLog) {
        throw new ConflictError("That action was not created by a manual advance.");
      }

      const laterMutations = await tx.auditLog.findFirst({
        where: {
          tournamentId: tournament.id,
          createdAt: { gt: auditLog.createdAt },
          action: {
            in: [...bracketMutationAuditActions]
          }
        },
        orderBy: { createdAt: "asc" }
      });

      if (laterMutations) {
        throw new ConflictError("That advance can no longer be undone because the bracket changed afterward.");
      }

      const snapshotBefore = this.extractSnapshotFromAuditLog(auditLog.metadataJson);
      const currentMatchIds = new Set(
        tournament.brackets.flatMap((bracket) => bracket.rounds).flatMap((round) => round.matches).map((match) => match.id)
      );
      const snapshotMatchIds = new Set(Object.keys(snapshotBefore.matches));
      if (
        currentMatchIds.size !== snapshotMatchIds.size ||
        [...currentMatchIds].some((matchId) => !snapshotMatchIds.has(matchId))
      ) {
        throw new ConflictError("That advance cannot be undone safely because the match structure changed.");
      }

      await this.applySnapshotToExistingMatchesTx(tx, tournament, snapshotBefore);
      await this.resetPlacementsFromSnapshotTx(tx, tournament, snapshotBefore);

      await tx.resultReport.update({
        where: { id: report.id },
        data: {
          status: MatchStatus.CANCELLED,
          reason: report.reason ? `${report.reason} | Undone by staff` : "Undone by staff"
        }
      });

      await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          status: snapshotBefore.isFinalized ? TournamentStatus.FINALIZED : TournamentStatus.IN_PROGRESS,
          completedAt: snapshotBefore.isFinalized ? tournament.completedAt : null
        }
      });

      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: tournament.guildId,
        actorUserId: input.actorUserId,
        action: AuditAction.MANUAL_ADVANCE_UNDONE,
        targetType: "ResultReport",
        targetId: report.id,
        metadataJson: {
          sourceAuditLogId: auditLog.id
        }
      });
    });

    await this.bracketSyncTarget?.syncTournamentBracket(input.tournamentId);
  }

  public async undoLatestManualAdvance(input: MatchActionInput) {
    const reportId = await prisma.$transaction(async (tx) => {
      await lockTournamentTx(tx, input.tournamentId);
      const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);

      const latestUndoableAdvance = await tx.auditLog.findFirst({
        where: {
          tournamentId: tournament.id,
          action: AuditAction.MANUAL_ADVANCE
        },
        orderBy: { createdAt: "desc" }
      });

      if (!latestUndoableAdvance) {
        throw new NotFoundError("No manual advance is available to undo.");
      }

      const laterMutations = await tx.auditLog.findFirst({
        where: {
          tournamentId: tournament.id,
          createdAt: { gt: latestUndoableAdvance.createdAt },
          action: {
            in: [...bracketMutationAuditActions]
          }
        },
        orderBy: { createdAt: "asc" }
      });

      if (laterMutations) {
        throw new ConflictError("The latest advance can no longer be undone because the bracket changed afterward.");
      }

      return latestUndoableAdvance.targetId;
    });

    await this.undoManualAdvance({
      ...input,
      reportId
    });

    return { reportId };
  }

  private async applyConfirmedOutcomeTx(
    tx: TransactionClient,
    tournament: TournamentWithRelations,
    sourceMatch: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number],
    report: PersistedReport,
    options: {
      actorUserId: string;
      auditAction: AuditAction;
      auditReason?: string;
      additionalMetadata?: Prisma.JsonObject;
    }
  ) {
    const winnerRegistrationId = report.proposedWinnerRegistrationId;
    const [player1RegistrationId, player2RegistrationId] = [
      sourceMatch.player1RegistrationId,
      sourceMatch.player2RegistrationId
    ];

    if (!winnerRegistrationId || !player1RegistrationId || !player2RegistrationId) {
      throw new ConflictError("This match is missing assigned participants.");
    }

    const loserRegistrationId =
      winnerRegistrationId === player1RegistrationId ? player2RegistrationId : player1RegistrationId;

    const snapshot = buildPersistedSnapshotFromTournament(tournament);
    const engine = BracketEngineFactory.create(
      tournament.format === "DOUBLE_ELIMINATION"
        ? "DOUBLE_ELIMINATION"
        : "SINGLE_ELIMINATION"
    );

    const advancement = engine.advance(snapshot, {
      matchId: sourceMatch.id,
      winnerId: winnerRegistrationId,
      loserId: loserRegistrationId
    } satisfies ReportMatchOutcomeInput);

    const matchUpdate = await tx.match.updateMany({
      where: {
        id: sourceMatch.id,
        version: sourceMatch.version,
        status: { in: [MatchStatus.AWAITING_CONFIRMATION, MatchStatus.READY, MatchStatus.DISPUTED] }
      },
      data: {
        status: MatchStatus.COMPLETED,
        winnerRegistrationId,
        loserRegistrationId,
        completedAt: new Date(),
        version: { increment: 1 }
      }
    });

    if (matchUpdate.count !== 1) {
      throw new ConflictError("This match was already confirmed or advanced.");
    }

    const changedMatchIds = new Set(advancement.changedMatchIds);
    changedMatchIds.delete(sourceMatch.id);

    for (const matchId of changedMatchIds) {
      const matchNode = advancement.snapshot.matches[matchId];
      if (!matchNode) {
        continue;
      }

      await tx.match.update({
        where: { id: matchId },
        data: this.matchNodeToUpdate(matchNode)
      });
    }

    await this.updatePlacementsTx(tx, tournament.id, advancement.snapshot);

    if (advancement.finalized && advancement.championId) {
      await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          status: TournamentStatus.FINALIZED,
          completedAt: new Date()
        }
      });
    }

    await writeAuditLogTx(tx, {
      tournamentId: tournament.id,
      guildId: tournament.guildId,
      actorUserId: options.actorUserId,
      action: options.auditAction,
      targetType: "ResultReport",
      targetId: report.id,
      reason: options.auditReason,
      metadataJson: {
        matchId: sourceMatch.id,
        winnerRegistrationId,
        loserRegistrationId,
        ...options.additionalMetadata
      }
    });

    await writeAuditLogTx(tx, {
      tournamentId: tournament.id,
      guildId: tournament.guildId,
      actorUserId: options.actorUserId,
      action: AuditAction.MATCH_ADVANCED,
      targetType: "Match",
      targetId: sourceMatch.id,
      metadataJson: {
        changedMatchIds: [...changedMatchIds],
        finalized: advancement.finalized,
        championId: advancement.championId
      }
    });

    if (advancement.finalized && advancement.championId) {
      await writeAuditLogTx(tx, {
        tournamentId: tournament.id,
        guildId: tournament.guildId,
        actorUserId: options.actorUserId,
        action: AuditAction.TOURNAMENT_FINALIZED,
        targetType: "Tournament",
        targetId: tournament.id,
        metadataJson: {
          championRegistrationId: advancement.championId
        }
      });
    }

    return {
      reportId: report.id,
      matchId: sourceMatch.id,
      winnerRegistrationId,
      loserRegistrationId,
      championRegistrationId: advancement.championId,
      finalized: advancement.finalized
    };
  }

  private async applyManualAdvanceTx(
    tx: TransactionClient,
    tournament: TournamentWithRelations,
    match: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number],
    winnerRegistrationId: string,
    options: {
      actorUserId: string;
      reason: string;
      idempotencyKey: string;
    }
  ) {
    const snapshotBefore = buildPersistedSnapshotFromTournament(tournament);

    this.validateTournamentIsActive(tournament);
    this.validateMatchReportableOrAwaiting(match);

    const assignedRegistrations = [match.player1RegistrationId, match.player2RegistrationId].filter(
      (entry): entry is string => entry != null
    );

    if (assignedRegistrations.length !== 2) {
      throw new ConflictError("Manual advancement requires two assigned participants.");
    }

    if (!assignedRegistrations.includes(winnerRegistrationId)) {
      throw new ValidationError("The selected winner is not assigned to this match.");
    }

    const createdReport = await tx.resultReport.create({
      data: {
        tournamentId: tournament.id,
        matchId: match.id,
        submittedByUserId: options.actorUserId,
        reporterRegistrationId: null,
        proposedWinnerRegistrationId: winnerRegistrationId,
        outcomeType: MatchOutcomeType.WALKOVER,
        status: MatchStatus.CONFIRMED,
        reason: sanitizeUserText(options.reason),
        confirmedByUserId: options.actorUserId,
        idempotencyKey: options.idempotencyKey
      }
    });

    return this.applyConfirmedOutcomeTx(tx, tournament, match, createdReport, {
      actorUserId: options.actorUserId,
      auditAction: AuditAction.MANUAL_ADVANCE,
      auditReason: sanitizeUserText(options.reason),
      additionalMetadata: {
        snapshotBefore: snapshotBefore as unknown as Prisma.JsonObject,
        sourceMatchId: match.id
      } as Prisma.JsonObject
    });
  }

  private matchNodeToUpdate(match: MatchNode): Prisma.MatchUpdateInput {
    return {
      player1RegistrationId: match.slots[0].entrantId,
      player2RegistrationId: match.slots[1].entrantId,
      status: this.domainStatusToDb(match.status),
      winnerRegistrationId: match.winnerId,
      loserRegistrationId: match.loserId,
      completedAt: match.status === "COMPLETED" ? new Date() : null
    };
  }

  private async updatePlacementsTx(
    tx: TransactionClient,
    tournamentId: string,
    snapshot: BracketSnapshot
  ): Promise<void> {
    const engine = BracketEngineFactory.create(snapshot.format);
    const placements = engine.calculatePlacements(snapshot);
    const placementByRegistrationId = new Map<string, number>();

    for (const group of placements) {
      for (const entrantId of group.entrantIds) {
        if (!placementByRegistrationId.has(entrantId)) {
          placementByRegistrationId.set(entrantId, group.placement);
        }
      }
    }

    for (const [registrationId, placement] of placementByRegistrationId.entries()) {
      await tx.registration.update({
        where: { id: registrationId },
        data: {
          placement,
          status: placement === 1 ? RegistrationStatus.ACTIVE : RegistrationStatus.ELIMINATED
        }
      });
    }
  }

  private async resetPlacementsFromSnapshotTx(
    tx: TransactionClient,
    tournament: TournamentWithRelations,
    snapshot: BracketSnapshot
  ): Promise<void> {
    await tx.registration.updateMany({
      where: {
        tournamentId: tournament.id,
        status: {
          in: [RegistrationStatus.ACTIVE, RegistrationStatus.ELIMINATED]
        }
      },
      data: {
        placement: null,
        status: RegistrationStatus.ACTIVE
      }
    });

    await this.updatePlacementsTx(tx, tournament.id, snapshot);
  }

  private async applySnapshotToExistingMatchesTx(
    tx: TransactionClient,
    tournament: TournamentWithRelations,
    snapshot: BracketSnapshot
  ): Promise<void> {
    for (const match of tournament.brackets.flatMap((bracket) => bracket.rounds).flatMap((round) => round.matches)) {
      const prior = snapshot.matches[match.id];
      if (!prior) {
        throw new ConflictError("Undo snapshot is missing a persisted match.");
      }

      await tx.match.update({
        where: { id: match.id },
        data: {
          player1RegistrationId: prior.slots[0].entrantId,
          player2RegistrationId: prior.slots[1].entrantId,
          status: this.domainStatusToDb(prior.status),
          winnerRegistrationId: prior.winnerId,
          loserRegistrationId: prior.loserId,
          completedAt: prior.status === "COMPLETED" ? match.completedAt ?? new Date() : null,
          version: { increment: 1 }
        }
      });
    }
  }

  private extractSnapshotFromAuditLog(metadataJson: Prisma.JsonValue | null): BracketSnapshot {
    if (
      !metadataJson ||
      typeof metadataJson !== "object" ||
      Array.isArray(metadataJson) ||
      !("snapshotBefore" in metadataJson)
    ) {
      throw new ConflictError("Undo data is unavailable for that advance.");
    }

    const snapshot = (metadataJson as { snapshotBefore?: BracketSnapshot }).snapshotBefore;
    if (!snapshot || typeof snapshot !== "object" || !("matches" in snapshot) || !("rounds" in snapshot)) {
      throw new ConflictError("Undo snapshot data is invalid.");
    }

    return snapshot;
  }

  private validateTournamentIsActive(tournament: TournamentWithRelations): void {
    if (tournament.status !== TournamentStatus.IN_PROGRESS) {
      throw new ConflictError("Match reporting is only available while a tournament is active.");
    }
  }

  private validateMatchReportable(
    match: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number]
  ): void {
    if (match.status !== MatchStatus.READY && match.status !== MatchStatus.DISPUTED) {
      throw new ConflictError("This match is not ready to receive a new result report.");
    }
  }

  private validateMatchReportableOrAwaiting(
    match: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number]
  ): void {
    if (
      match.status !== MatchStatus.READY &&
      match.status !== MatchStatus.DISPUTED &&
      match.status !== MatchStatus.AWAITING_CONFIRMATION
    ) {
      throw new ConflictError("This match cannot be overridden in its current state.");
    }
  }

  private validateActorAssignedToMatch(
    match: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number],
    actorRegistrationId: string
  ): void {
    if (
      match.player1RegistrationId !== actorRegistrationId &&
      match.player2RegistrationId !== actorRegistrationId
    ) {
      throw new ValidationError("You are not assigned to this match.");
    }
  }

  private validateEntrantsForMatch(
    match: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number],
    winnerRegistrationId: string,
    loserRegistrationId: string
  ): void {
    const assigned = [match.player1RegistrationId, match.player2RegistrationId].filter(
      (entry): entry is string => entry != null
    );

    if (assigned.length !== 2) {
      throw new ConflictError("This match does not yet have two assigned participants.");
    }

    if (!assigned.includes(winnerRegistrationId) || !assigned.includes(loserRegistrationId)) {
      throw new ValidationError("Submitted entrants do not match the assigned match participants.");
    }

    if (winnerRegistrationId === loserRegistrationId) {
      throw new ValidationError("Winner and loser must be different participants.");
    }
  }

  private validateOutcomeAndScores(
    bestOf: number,
    input: Pick<
      ReportResultInput,
      "outcomeType" | "winnerScore" | "loserScore" | "winnerRegistrationId" | "loserRegistrationId"
    >
  ): void {
    if (input.winnerRegistrationId === input.loserRegistrationId) {
      throw new ValidationError("Winner and loser must be different participants.");
    }

    if (input.outcomeType === MatchOutcomeType.SCORE) {
      if (input.winnerScore == null || input.loserScore == null) {
        throw new ValidationError("Score-based reports require both winner and loser scores.");
      }

      const winsNeeded = Math.ceil(bestOf / 2);
      if (input.winnerScore !== winsNeeded) {
        throw new ValidationError(`Winner score must be exactly ${winsNeeded} for a best-of-${bestOf} match.`);
      }

      if (input.loserScore < 0 || input.loserScore >= winsNeeded) {
        throw new ValidationError("Loser score is invalid for this best-of setting.");
      }

      if (input.winnerScore <= input.loserScore) {
        throw new ValidationError("Winner score must be greater than loser score.");
      }

      return;
    }

    if (input.winnerScore != null || input.loserScore != null) {
      throw new ValidationError("Scores may only be submitted for score-based results.");
    }
  }

  private ensureNoPendingReport(
    match: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number]
  ): void {
    const pending = match.reports.find((entry) => entry.status === MatchStatus.AWAITING_CONFIRMATION);
    if (pending) {
      throw new ConflictError("A result report is already awaiting confirmation for this match.");
    }
  }

  private findActorRegistration(
    tournament: TournamentWithRelations,
    actorUserId: string,
    requireActive: boolean
  ) {
    const registration = tournament.registrations.find(
      (entry) => entry.participant.discordUserId === actorUserId
    );

    if (!registration) {
      throw new NotFoundError("You are not registered for this tournament.");
    }

    if (requireActive && registration.status !== RegistrationStatus.ACTIVE) {
      throw new ConflictError("Only active participants may perform this action.");
    }

    return registration;
  }

  private findRegistrationForManualAdvance(
    tournament: TournamentWithRelations,
    input: Pick<ManualAdvanceSelectionInput, "targetUserId" | "targetPlayerName">
  ) {
    const activeRegistrations = tournament.registrations.filter(
      (entry) => entry.status === RegistrationStatus.ACTIVE
    );
    const activeMatchRegistrationIds = new Set(
      tournament.brackets
        .flatMap((bracket) => bracket.rounds)
        .flatMap((round) => round.matches)
        .filter(
          (match) => match.status === MatchStatus.READY || match.status === MatchStatus.DISPUTED
        )
        .flatMap((match) => [match.player1RegistrationId, match.player2RegistrationId])
        .filter((entry): entry is string => entry != null)
    );
    const advanceableRegistrations = activeRegistrations.filter((entry) =>
      activeMatchRegistrationIds.has(entry.id)
    );

    if (input.targetUserId) {
      const registration = advanceableRegistrations.find(
        (entry) => entry.participant.discordUserId === input.targetUserId
      );

      if (!registration) {
        throw new NotFoundError("That Discord user is not in an advanceable match right now.");
      }

      return registration;
    }

    const targetPlayerName = input.targetPlayerName?.trim().toLowerCase();
    const exactMatches = advanceableRegistrations.filter(
      (entry) => entry.participant.displayName.trim().toLowerCase() === targetPlayerName
    );

    if (exactMatches.length === 1) {
      return exactMatches[0]!;
    }

    if (exactMatches.length > 1) {
      throw new ConflictError("Multiple advanceable players matched that name. Use the Discord user option instead.");
    }

    const partialMatches = advanceableRegistrations.filter((entry) =>
      entry.participant.displayName.trim().toLowerCase().includes(targetPlayerName ?? "")
    );

    if (partialMatches.length === 0) {
      throw new NotFoundError("No advanceable player matched that name.");
    }

    if (partialMatches.length > 1) {
      throw new ConflictError("Multiple advanceable players matched that name. Use a more specific name or the Discord user option.");
    }

    return partialMatches[0]!;
  }

  private requireMatchRecord(tournament: TournamentWithRelations, matchId: string) {
    const match = tournament.brackets
      .flatMap((bracket) => bracket.rounds)
      .flatMap((round) => round.matches)
      .find((entry) => entry.id === matchId);

    if (!match) {
      throw new NotFoundError("Match not found for this tournament.");
    }

    return match;
  }

  private requireReport(tournament: TournamentWithRelations, reportId: string) {
    const report = tournament.brackets
      .flatMap((bracket) => bracket.rounds)
      .flatMap((round) => round.matches)
      .flatMap((match) => match.reports)
      .find((entry) => entry.id === reportId);

    if (!report) {
      throw new NotFoundError("Result report not found for this tournament.");
    }

    return report;
  }

  private scoreForPlayerSlot(
    match: TournamentWithRelations["brackets"][number]["rounds"][number]["matches"][number],
    input: Pick<
      ReportResultInput,
      "winnerRegistrationId" | "winnerScore" | "loserScore" | "outcomeType"
    >,
    slot: 1 | 2
  ): number | null {
    if (input.outcomeType !== MatchOutcomeType.SCORE) {
      return null;
    }

    const registrationId = slot === 1 ? match.player1RegistrationId : match.player2RegistrationId;
    if (!registrationId) {
      return null;
    }

    return registrationId === input.winnerRegistrationId
      ? input.winnerScore ?? null
      : input.loserScore ?? null;
  }

  private async loadTournamentTx(
    tx: TransactionClient,
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
        resultReports: true,
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

  private async requireTournamentWithRelations(tournamentId: string, guildId: string) {
    const tournament = await this.tournamentRepository.getTournament(tournamentId);
    if (!tournament || tournament.guildId !== guildId) {
      throw new NotFoundError("Tournament not found.");
    }
    return tournament;
  }

  private domainStatusToDb(status: MatchNode["status"]): MatchStatus {
    if (status === "COMPLETED") return MatchStatus.COMPLETED;
    if (status === "READY") return MatchStatus.READY;
    if (status === "CANCELLED") return MatchStatus.CANCELLED;
    return MatchStatus.PENDING;
  }
}
