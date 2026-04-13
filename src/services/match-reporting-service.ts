import {
  AuditAction,
  BracketType,
  MatchOutcomeType,
  MatchStatus,
  Prisma,
  RegistrationStatus,
  TournamentFormat,
  TournamentStatus
} from "@prisma/client";

import { prisma } from "../config/prisma.js";
import { BracketEngineFactory } from "../domain/bracket/engine.js";
import type {
  BracketSnapshot,
  MatchNode,
  ReportMatchOutcomeInput,
  RoundNode
} from "../domain/bracket/types.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
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

type TournamentWithRelations = NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>;
type TransactionClient = Prisma.TransactionClient;
type PersistedReport = {
  id: string;
  matchId: string;
  proposedWinnerRegistrationId: string | null;
  reason: string | null;
};

export class MatchReportingService {
  public constructor(private readonly tournamentRepository: TournamentRepository) {}

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
    return prisma.$transaction(async (tx) => {
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

      await this.writeAuditLogTx(tx, {
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
  }

  public async confirmResult(input: ConfirmResultInput) {
    return prisma.$transaction(async (tx) => {
      const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);
      const actorRegistration = this.findActorRegistration(tournament, input.actorUserId, true);
      const report = this.requireReport(tournament, input.reportId);
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
  }

  public async disputeResult(input: DisputeResultInput) {
    return prisma.$transaction(async (tx) => {
      const tournament = await this.loadTournamentTx(tx, input.tournamentId, input.guildId);
      const actorRegistration = this.findActorRegistration(tournament, input.actorUserId, true);
      const report = this.requireReport(tournament, input.reportId);
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

      await this.writeAuditLogTx(tx, {
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
    return prisma.$transaction(async (tx) => {
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

    const snapshot = this.buildSnapshotFromTournament(tournament);
    const engine = BracketEngineFactory.create(
      tournament.format === TournamentFormat.DOUBLE_ELIMINATION
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

    await this.writeAuditLogTx(tx, {
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
        loserRegistrationId
      }
    });

    await this.writeAuditLogTx(tx, {
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
      await this.writeAuditLogTx(tx, {
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

  private buildSnapshotFromTournament(tournament: TournamentWithRelations): BracketSnapshot {
    const rounds: RoundNode[] = [];
    const matches: Record<string, MatchNode> = {};

    for (const bracket of tournament.brackets) {
      for (const round of bracket.rounds) {
        rounds.push({
          id: round.id,
          side: this.bracketTypeToSide(bracket.type),
          roundNumber: round.roundNumber,
          name: round.name,
          matchIds: round.matches.map((match) => match.id)
        });

        for (const match of round.matches) {
          matches[match.id] = {
            id: match.id,
            side: this.bracketTypeToSide(match.bracketType),
            roundNumber: round.roundNumber,
            sequence: match.sequence,
            bestOf: match.bestOf,
            status: this.matchStatusToDomain(match.status),
            slots: [
              {
                entrantId: match.player1RegistrationId,
                sourceMatchId: null,
                sourceOutcome: null,
                isBye: match.player1RegistrationId == null
              },
              {
                entrantId: match.player2RegistrationId,
                sourceMatchId: null,
                sourceOutcome: null,
                isBye: match.player2RegistrationId == null
              }
            ],
            winnerId: match.winnerRegistrationId,
            loserId: match.loserRegistrationId,
            nextMatchId: match.nextMatchId,
            nextMatchSlot: this.toDomainSlot(match.nextMatchSlot),
            loserNextMatchId: match.loserNextMatchId,
            loserNextMatchSlot: this.toDomainSlot(match.loserNextMatchSlot),
            resetOfMatchId: match.resetOfMatchId
          };
        }
      }
    }

    const championMatch = Object.values(matches)
      .filter((match) => match.side === "GRAND_FINALS" || match.nextMatchId == null)
      .sort((left, right) => {
        const sideWeight = (value: MatchNode["side"]) =>
          value === "WINNERS" ? 0 : value === "LOSERS" ? 1 : 2;
        return sideWeight(right.side) - sideWeight(left.side) || right.roundNumber - left.roundNumber;
      })[0];

    return {
      format:
        tournament.format === TournamentFormat.DOUBLE_ELIMINATION
          ? "DOUBLE_ELIMINATION"
          : "SINGLE_ELIMINATION",
      rounds,
      matches,
      championId: championMatch?.winnerId ?? null,
      isFinalized: tournament.status === TournamentStatus.FINALIZED,
      metadata: {
        hasGrandFinalReset:
          tournament.format === TournamentFormat.DOUBLE_ELIMINATION &&
          (tournament.settings?.grandFinalResetEnabled ?? true),
        initialEntrantCount: tournament.registrations.length,
        bracketSize: Math.max(
          2,
          Object.values(matches).filter((match) => match.side === "WINNERS").length * 2
        )
      }
    };
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

  private bracketTypeToSide(bracketType: BracketType): MatchNode["side"] {
    if (bracketType === BracketType.WINNERS) return "WINNERS";
    if (bracketType === BracketType.LOSERS) return "LOSERS";
    return "GRAND_FINALS";
  }

  private matchStatusToDomain(status: MatchStatus): MatchNode["status"] {
    if (status === MatchStatus.COMPLETED || status === MatchStatus.CONFIRMED) {
      return "COMPLETED";
    }
    if (status === MatchStatus.CANCELLED) {
      return "CANCELLED";
    }
    if (status === MatchStatus.READY || status === MatchStatus.AWAITING_CONFIRMATION) {
      return "READY";
    }
    return "PENDING";
  }

  private domainStatusToDb(status: MatchNode["status"]): MatchStatus {
    if (status === "COMPLETED") return MatchStatus.COMPLETED;
    if (status === "READY") return MatchStatus.READY;
    if (status === "CANCELLED") return MatchStatus.CANCELLED;
    return MatchStatus.PENDING;
  }

  private toDomainSlot(value: number | null): 0 | 1 | null {
    if (value == null) return null;
    if (value !== 0 && value !== 1) {
      throw new ValidationError("Stored match slot link is invalid.");
    }
    return value;
  }

  private async writeAuditLogTx(
    tx: TransactionClient,
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
