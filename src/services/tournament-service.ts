import crypto from "node:crypto";

import {
  AuditAction,
  BracketType,
  MatchStatus,
  RegistrationStatus,
  SeedingMethod,
  TournamentFormat,
  TournamentStatus,
  type Participant,
  type Registration
} from "@prisma/client";

import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { BracketEngine, type BracketParticipant, type GeneratedBracket } from "../domain/bracket/index.js";
import { PermissionService } from "../permissions/role-permissions.js";
import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { MatchRepository } from "../repositories/match-repository.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { sanitizeUserText } from "../utils/sanitize.js";
import {
  configTournamentSchema,
  createTournamentSchema,
  reportResultSchema
} from "../validators/tournament.js";

const activeStatuses: TournamentStatus[] = [
  TournamentStatus.REGISTRATION_OPEN,
  TournamentStatus.REGISTRATION_CLOSED,
  TournamentStatus.CHECK_IN,
  TournamentStatus.IN_PROGRESS,
  TournamentStatus.PAUSED
];

const seededShuffle = <T>(items: T[], seed: string): T[] => {
  const copy = [...items];
  let state = BigInt(
    `0x${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`
  );

  const next = () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    return Number(state & 0xffffffffn);
  };

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.abs(next()) % (index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }

  return copy;
};

export class TournamentService {
  private readonly bracketEngine = new BracketEngine();

  public readonly permissionService: PermissionService;

  public constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly tournamentRepository: TournamentRepository,
    private readonly matchRepository: MatchRepository
  ) {
    this.permissionService = new PermissionService(guildConfigRepository);
  }

  public async createTournament(args: {
    guildId: string;
    actorUserId: string;
    input: unknown;
  }) {
    const input = createTournamentSchema.parse(args.input);
    const guildConfig = await this.guildConfigRepository.getOrCreate(args.guildId);

    const tournament = await this.tournamentRepository.createTournament({
      guildId: args.guildId,
      guildConfig: {
        connect: { id: guildConfig.id }
      },
      createdByUserId: args.actorUserId,
      name: sanitizeUserText(input.name, 80),
      description: input.description ? sanitizeUserText(input.description, 500) : null,
      format: input.format,
      maxParticipants: input.maxParticipants,
      bestOfDefault: input.bestOfDefault,
      requireCheckIn: input.requireCheckIn,
      allowWaitlist: input.allowWaitlist,
      allowWithdrawals: input.allowWithdrawals,
      settings: {
        create: {
          seedingMethod: SeedingMethod.RANDOM,
          hasLosersBracket: input.format === TournamentFormat.DOUBLE_ELIMINATION,
          grandFinalResetEnabled: input.format === TournamentFormat.DOUBLE_ELIMINATION
        }
      }
    });

    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: AuditAction.TOURNAMENT_CREATED,
      targetType: "Tournament",
      targetId: tournament.id
    });

    return tournament;
  }

  public async configureTournament(args: {
    guildId: string;
    actorUserId: string;
    tournamentId: string;
    input: unknown;
  }) {
    const input = configTournamentSchema.parse(args.input);
    const tournament = await this.requireTournament(args.tournamentId, args.guildId);

    if (tournament.status !== TournamentStatus.DRAFT) {
      throw new ConflictError("Tournament configuration can only be changed while in draft state.");
    }

    const updated = await prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        mutualExclusionKey: input.mutualExclusionKey,
        settings: {
          update: {
            seedingMethod: input.seedingMethod,
            requireOpponentConfirmation: input.requireOpponentConfirmation,
            hasLosersBracket: input.hasLosersBracket,
            grandFinalResetEnabled: input.grandFinalResetEnabled
          }
        }
      },
      include: { settings: true }
    });

    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: AuditAction.TOURNAMENT_UPDATED,
      targetType: "Tournament",
      targetId: tournament.id
    });

    return updated;
  }

  public async openRegistration(tournamentId: string, guildId: string, actorUserId: string) {
    const tournament = await this.requireTournament(tournamentId, guildId);
    if (tournament.status !== TournamentStatus.DRAFT && tournament.status !== TournamentStatus.REGISTRATION_CLOSED) {
      throw new ConflictError("Only draft or closed tournaments can open registration.");
    }

    const updated = await this.tournamentRepository.updateTournament(tournamentId, {
      status: TournamentStatus.REGISTRATION_OPEN
    });
    await this.audit({
      tournamentId,
      guildId,
      actorUserId,
      action: AuditAction.TOURNAMENT_OPENED,
      targetType: "Tournament",
      targetId: tournamentId
    });
    return updated;
  }

  public async closeRegistration(tournamentId: string, guildId: string, actorUserId: string) {
    const tournament = await this.requireTournament(tournamentId, guildId);
    if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
      throw new ConflictError("Registration is not currently open.");
    }

    const nextStatus = tournament.requireCheckIn
      ? TournamentStatus.CHECK_IN
      : TournamentStatus.REGISTRATION_CLOSED;
    const updated = await this.tournamentRepository.updateTournament(tournamentId, {
      status: nextStatus
    });
    await this.audit({
      tournamentId,
      guildId,
      actorUserId,
      action: AuditAction.TOURNAMENT_CLOSED,
      targetType: "Tournament",
      targetId: tournamentId
    });
    return updated;
  }

  public async joinTournament(args: {
    guildId: string;
    tournamentId: string;
    userId: string;
    displayName: string;
  }) {
    const tournament = (await this.requireTournament(args.tournamentId, args.guildId, true)) as any;

    if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
      throw new ConflictError("This tournament is not accepting registrations.");
    }

    const participant = await this.tournamentRepository.createOrGetParticipant({
      guildId: args.guildId,
      discordUserId: args.userId,
      displayName: sanitizeUserText(args.displayName, 80)
    });

    const existingRegistration = tournament.registrations.find(
      (registration: any) =>
        registration.participant.discordUserId === args.userId &&
        [RegistrationStatus.ACTIVE, RegistrationStatus.WAITLISTED].includes(registration.status)
    );
    if (existingRegistration) {
      throw new ConflictError("You are already registered for this tournament.");
    }

    if (tournament.mutualExclusionKey) {
      const conflicting = await this.tournamentRepository.findActiveMutualExclusion({
        guildId: args.guildId,
        participantId: participant.id,
        mutualExclusionKey: tournament.mutualExclusionKey,
        tournamentId: tournament.id
      });
      if (conflicting) {
        throw new ConflictError("You are already entered in a mutually exclusive tournament.");
      }
    }

    const activeCount = tournament.registrations.filter(
      (registration: any) => registration.status === RegistrationStatus.ACTIVE
    ).length;
    const registrationKey = crypto
      .createHash("sha256")
      .update(`${tournament.id}:${participant.id}`)
      .digest("hex");

    const waitlist = activeCount >= tournament.maxParticipants;
    if (waitlist && !tournament.allowWaitlist) {
      throw new ConflictError("This tournament is full.");
    }

    await this.tournamentRepository.joinTournament({
      tournamentId: tournament.id,
      participantId: participant.id,
      registrationKey,
      waitlist
    });

    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.userId,
      action: AuditAction.PARTICIPANT_JOINED,
      targetType: "Participant",
      targetId: participant.id
    });

    return { participant, waitlist };
  }

  public async leaveTournament(args: {
    guildId: string;
    tournamentId: string;
    userId: string;
  }) {
    const tournament = (await this.requireTournament(args.tournamentId, args.guildId, true)) as any;
    if (!tournament.allowWithdrawals) {
      throw new ConflictError("Withdrawals are disabled for this tournament.");
    }

    if (!activeStatuses.includes(tournament.status)) {
      throw new ConflictError("You cannot leave this tournament at its current stage.");
    }

    const registration = tournament.registrations.find(
      (entry: any) => entry.participant.discordUserId === args.userId && entry.status === RegistrationStatus.ACTIVE
    );

    if (!registration) {
      throw new NotFoundError("You are not registered in this tournament.");
    }

    if (tournament.status === TournamentStatus.IN_PROGRESS) {
      throw new ConflictError("Once a tournament has started, players must be dropped or disqualified by staff.");
    }

    await this.tournamentRepository.withdrawRegistration(registration.id);
    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.userId,
      action: AuditAction.PARTICIPANT_LEFT,
      targetType: "Registration",
      targetId: registration.id
    });
    return registration;
  }

  public async checkIn(args: { guildId: string; tournamentId: string; userId: string }) {
    const tournament = (await this.requireTournament(args.tournamentId, args.guildId, true)) as any;

    if (tournament.status !== TournamentStatus.CHECK_IN) {
      throw new ConflictError("Check-in is not currently open for this tournament.");
    }

    const registration = tournament.registrations.find(
      (entry: any) => entry.participant.discordUserId === args.userId && entry.status === RegistrationStatus.ACTIVE
    );

    if (!registration) {
      throw new NotFoundError("You are not registered for this tournament.");
    }

    if (registration.checkIn) {
      throw new ConflictError("You have already checked in.");
    }

    await prisma.checkIn.create({
      data: {
        tournamentId: tournament.id,
        registrationId: registration.id,
        participantId: registration.participantId
      }
    });

    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.userId,
      action: AuditAction.PARTICIPANT_CHECKED_IN,
      targetType: "Registration",
      targetId: registration.id
    });
    return registration;
  }

  public async startTournament(args: { guildId: string; tournamentId: string; actorUserId: string }) {
    const tournament = (await this.requireTournament(args.tournamentId, args.guildId, true)) as any;
    if (
      tournament.status !== TournamentStatus.REGISTRATION_CLOSED &&
      tournament.status !== TournamentStatus.CHECK_IN
    ) {
      throw new ConflictError("Tournament must be closed before it can be started.");
    }

    const activeRegistrations = tournament.registrations.filter(
      (registration: any) => registration.status === RegistrationStatus.ACTIVE
    );
    const eligible = tournament.requireCheckIn
      ? activeRegistrations.filter((registration: any) => Boolean(registration.checkIn))
      : activeRegistrations;

    if (eligible.length < 2) {
      throw new ConflictError("At least two eligible participants are required to start the tournament.");
    }

    const seededRegistrations = this.seedRegistrations(
      eligible,
      tournament.settings?.seedingMethod ?? SeedingMethod.RANDOM,
      tournament.id
    );

    await this.tournamentRepository.assignSeeds(
      tournament.id,
      seededRegistrations.map((registration) => registration.id)
    );

    const participants: BracketParticipant[] = seededRegistrations.map((registration, index) => ({
      registrationId: registration.id,
      seedNumber: index + 1,
      rating: registration.participant.rating
    }));

    const generated = this.bracketEngine.generateBracket({
      format:
        tournament.format === TournamentFormat.DOUBLE_ELIMINATION
          ? "DOUBLE_ELIMINATION"
          : "SINGLE_ELIMINATION",
      participants,
      bestOf: tournament.bestOfDefault,
      grandFinalResetEnabled: tournament.settings?.grandFinalResetEnabled ?? true
    });

    await this.persistGeneratedBracket(tournament.id, generated);
    const updated = await this.tournamentRepository.updateTournament(tournament.id, {
      status: TournamentStatus.IN_PROGRESS,
      startedAt: new Date()
    });

    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: AuditAction.BRACKET_GENERATED,
      targetType: "Tournament",
      targetId: tournament.id
    });
    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: AuditAction.TOURNAMENT_STARTED,
      targetType: "Tournament",
      targetId: tournament.id
    });
    return updated;
  }

  public async reportResult(args: {
    guildId: string;
    tournamentId: string;
    actorUserId: string;
    input: unknown;
    staffOverride?: boolean;
  }) {
    const input = reportResultSchema.parse(args.input);
    const tournament = (await this.requireTournament(args.tournamentId, args.guildId, true)) as any;
    if (
      tournament.status !== TournamentStatus.IN_PROGRESS &&
      tournament.status !== TournamentStatus.PAUSED
    ) {
      throw new ConflictError("This tournament is not currently accepting match results.");
    }

    if (tournament.status === TournamentStatus.PAUSED && !args.staffOverride) {
      throw new ConflictError("Tournament is paused. Only staff overrides are allowed.");
    }

    const match = await this.matchRepository.getMatch(input.matchId);
    if (!match || match.tournamentId !== tournament.id) {
      throw new NotFoundError("Match not found.");
    }

    if (
      match.status !== MatchStatus.READY &&
      match.status !== MatchStatus.AWAITING_CONFIRMATION &&
      match.status !== MatchStatus.DISPUTED
    ) {
      throw new ConflictError("This match is not ready for reporting.");
    }

    const participantRegistrationIds = [match.player1RegistrationId, match.player2RegistrationId].filter(
      (value): value is string => Boolean(value)
    );
    const reportingRegistration = tournament.registrations.find(
      (registration: any) => registration.participant.discordUserId === args.actorUserId
    );

    if (!args.staffOverride) {
      if (!reportingRegistration || !participantRegistrationIds.includes(reportingRegistration.id)) {
        throw new ConflictError("Only active match participants can self-report this match.");
      }
    }

    if (
      !participantRegistrationIds.includes(input.winnerRegistrationId) ||
      !participantRegistrationIds.includes(input.loserRegistrationId)
    ) {
      throw new ValidationError("Submitted players do not match the assigned participants.");
    }

    const winsNeeded = Math.ceil(match.bestOf / 2);
    const reportedMax = Math.max(input.player1Score, input.player2Score);
    if (reportedMax !== winsNeeded) {
      throw new ValidationError(`A best-of-${match.bestOf} match requires ${winsNeeded} wins.`);
    }

    const report = await this.matchRepository.createResultReport({
      tournament: { connect: { id: tournament.id } },
      match: { connect: { id: match.id } },
      submittedByUserId: args.actorUserId,
      reporterRegistrationId: reportingRegistration?.id,
      proposedWinnerRegistrationId: input.winnerRegistrationId,
      outcomeType: "SCORE",
      player1Score: input.player1Score,
      player2Score: input.player2Score,
      reason: input.reason ? sanitizeUserText(input.reason) : null,
      idempotencyKey: `${tournament.id}:${match.id}:${input.idempotencyKey}`,
      status:
        args.staffOverride || !(tournament.settings?.requireOpponentConfirmation ?? true)
          ? MatchStatus.CONFIRMED
          : MatchStatus.AWAITING_CONFIRMATION
    });

    await prisma.match.update({
      where: { id: match.id },
      data: {
        status:
          args.staffOverride || !(tournament.settings?.requireOpponentConfirmation ?? true)
            ? MatchStatus.CONFIRMED
            : MatchStatus.AWAITING_CONFIRMATION
      }
    });

    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: AuditAction.RESULT_REPORTED,
      targetType: "Match",
      targetId: match.id,
      reason: input.reason
    });

    if (report.status === MatchStatus.CONFIRMED) {
      await this.applyConfirmedReport(tournament.id, report.id, args.actorUserId);
    }

    return report;
  }

  public async confirmResult(args: {
    guildId: string;
    tournamentId: string;
    reportId: string;
    actorUserId: string;
  }) {
    const tournament = (await this.requireTournament(args.tournamentId, args.guildId, true)) as any;
    const report = await prisma.resultReport.findUnique({
      where: { id: args.reportId },
      include: { match: true }
    });
    if (!report || report.tournamentId !== tournament.id) {
      throw new NotFoundError("Result report not found.");
    }

    if (report.status !== MatchStatus.AWAITING_CONFIRMATION) {
      throw new ConflictError("This report is not awaiting confirmation.");
    }

    const confirmer = tournament.registrations.find(
      (registration: any) => registration.participant.discordUserId === args.actorUserId
    );
    const opponentIds = [report.match.player1RegistrationId, report.match.player2RegistrationId].filter(
      (value): value is string => Boolean(value)
    );

    if (!confirmer || !opponentIds.includes(confirmer.id) || confirmer.id === report.reporterRegistrationId) {
      throw new ConflictError("Only the opposing participant may confirm this result.");
    }

    await this.matchRepository.markReportStatus(report.id, MatchStatus.CONFIRMED, {
      confirmedByUserId: args.actorUserId
    });
    await this.audit({
      tournamentId: tournament.id,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: AuditAction.RESULT_CONFIRMED,
      targetType: "ResultReport",
      targetId: report.id
    });
    await this.applyConfirmedReport(tournament.id, report.id, args.actorUserId);
  }

  public async disputeResult(args: {
    guildId: string;
    tournamentId: string;
    reportId: string;
    actorUserId: string;
    reason?: string;
  }) {
    const report = await prisma.resultReport.findUnique({
      where: { id: args.reportId },
      include: { match: true }
    });
    if (!report || report.tournamentId !== args.tournamentId) {
      throw new NotFoundError("Result report not found.");
    }

    await this.matchRepository.markReportStatus(report.id, MatchStatus.DISPUTED, {
      disputedByUserId: args.actorUserId
    });
    await prisma.match.update({
      where: { id: report.matchId },
      data: { status: MatchStatus.DISPUTED }
    });
    await this.audit({
      tournamentId: args.tournamentId,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: AuditAction.RESULT_DISPUTED,
      targetType: "ResultReport",
      targetId: report.id,
      reason: args.reason
    });
  }

  public async pauseTournament(tournamentId: string, guildId: string, actorUserId: string) {
    const tournament = await this.requireTournament(tournamentId, guildId);
    if (tournament.status !== TournamentStatus.IN_PROGRESS) {
      throw new ConflictError("Only in-progress tournaments can be paused.");
    }
    const updated = await this.tournamentRepository.updateTournament(tournamentId, {
      status: TournamentStatus.PAUSED
    });
    await this.audit({
      tournamentId,
      guildId,
      actorUserId,
      action: AuditAction.TOURNAMENT_PAUSED,
      targetType: "Tournament",
      targetId: tournamentId
    });
    return updated;
  }

  public async resumeTournament(tournamentId: string, guildId: string, actorUserId: string) {
    const tournament = await this.requireTournament(tournamentId, guildId);
    if (tournament.status !== TournamentStatus.PAUSED) {
      throw new ConflictError("Only paused tournaments can be resumed.");
    }
    const updated = await this.tournamentRepository.updateTournament(tournamentId, {
      status: TournamentStatus.IN_PROGRESS
    });
    await this.audit({
      tournamentId,
      guildId,
      actorUserId,
      action: AuditAction.TOURNAMENT_RESUMED,
      targetType: "Tournament",
      targetId: tournamentId
    });
    return updated;
  }

  public async cancelTournament(tournamentId: string, guildId: string, actorUserId: string, reason?: string) {
    const tournament = await this.requireTournament(tournamentId, guildId);
    if (
      tournament.status === TournamentStatus.CANCELLED ||
      tournament.status === TournamentStatus.FINALIZED ||
      tournament.status === TournamentStatus.ARCHIVED
    ) {
      throw new ConflictError("This tournament can no longer be cancelled.");
    }
    const updated = await this.tournamentRepository.updateTournament(tournamentId, {
      status: TournamentStatus.CANCELLED
    });
    await this.audit({
      tournamentId,
      guildId,
      actorUserId,
      action: AuditAction.TOURNAMENT_CANCELLED,
      targetType: "Tournament",
      targetId: tournamentId,
      reason
    });
    return updated;
  }

  public async finalizeTournament(tournamentId: string, guildId: string, actorUserId: string) {
    const tournament = await this.requireTournament(tournamentId, guildId, true);
    if (
      tournament.status !== TournamentStatus.IN_PROGRESS &&
      tournament.status !== TournamentStatus.PAUSED
    ) {
      throw new ConflictError("Only active tournaments can be finalized.");
    }
    const updated = await this.tournamentRepository.updateTournament(tournamentId, {
      status: TournamentStatus.FINALIZED,
      completedAt: new Date()
    });
    await this.audit({
      tournamentId,
      guildId,
      actorUserId,
      action: AuditAction.TOURNAMENT_FINALIZED,
      targetType: "Tournament",
      targetId: tournamentId
    });
    return updated;
  }

  public async archiveTournament(tournamentId: string, guildId: string, actorUserId: string) {
    const tournament = await this.requireTournament(tournamentId, guildId);
    if (
      tournament.status !== TournamentStatus.FINALIZED &&
      tournament.status !== TournamentStatus.CANCELLED
    ) {
      throw new ConflictError("Only finalized or cancelled tournaments can be archived.");
    }
    const updated = await this.tournamentRepository.updateTournament(tournamentId, {
      status: TournamentStatus.ARCHIVED,
      archivedAt: new Date()
    });
    await this.audit({
      tournamentId,
      guildId,
      actorUserId,
      action: AuditAction.TOURNAMENT_ARCHIVED,
      targetType: "Tournament",
      targetId: tournamentId
    });
    return updated;
  }

  public async getTournamentOverview(tournamentId: string, guildId: string) {
    return this.requireTournament(tournamentId, guildId, true);
  }

  public async getParticipantMatches(args: { tournamentId: string; guildId: string; userId: string }) {
    const tournament = (await this.requireTournament(args.tournamentId, args.guildId, true)) as any;
    const registration = tournament.registrations.find(
      (entry: any) => entry.participant.discordUserId === args.userId && entry.status === RegistrationStatus.ACTIVE
    );
    if (!registration) {
      throw new NotFoundError("You are not an active participant in this tournament.");
    }

    return this.matchRepository.listParticipantActiveMatches(tournament.id, registration.id);
  }

  private seedRegistrations(
    registrations: Array<Registration & { participant: Participant }>,
    seedingMethod: SeedingMethod,
    tournamentId: string
  ) {
    if (seedingMethod === SeedingMethod.MANUAL) {
      return [...registrations].sort(
        (left, right) => left.joinedAt.getTime() - right.joinedAt.getTime()
      );
    }

    if (seedingMethod === SeedingMethod.RATING_BASED) {
      return [...registrations].sort(
        (left, right) => (right.participant.rating ?? 0) - (left.participant.rating ?? 0)
      );
    }

    return seededShuffle(
      [...registrations].sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime()),
      tournamentId
    );
  }

  private async persistGeneratedBracket(tournamentId: string, generated: GeneratedBracket) {
    await this.tournamentRepository.createBracketSnapshot({
      tournamentId,
      bestOf: generated.rounds[0]?.matches[0]?.bestOf ?? 3,
      rounds: generated.rounds.map((round) => ({
        bracketType:
          round.bracketType === "WINNERS"
            ? BracketType.WINNERS
            : round.bracketType === "LOSERS"
              ? BracketType.LOSERS
              : BracketType.GRAND_FINALS,
        roundNumber: round.roundNumber,
        name: round.name,
        matches: round.matches.map((match) => ({
          id: match.id,
          sequence: match.sequence,
          bestOf: match.bestOf,
          player1RegistrationId: match.player1RegistrationId,
          player2RegistrationId: match.player2RegistrationId,
          status:
            match.status === "READY"
              ? MatchStatus.READY
              : match.status === "COMPLETED"
                ? MatchStatus.COMPLETED
                : MatchStatus.PENDING,
          winnerRegistrationId: match.winnerRegistrationId,
          loserRegistrationId: match.loserRegistrationId,
          nextMatchId: match.nextMatchId,
          nextMatchSlot: match.nextMatchSlot,
          loserNextMatchId: match.loserNextMatchId,
          loserNextMatchSlot: match.loserNextMatchSlot,
          resetOfMatchId: match.resetOfMatchId
        }))
      }))
    });
  }

  private async applyConfirmedReport(tournamentId: string, reportId: string, actorUserId: string) {
    const tournament = await this.requireTournament(tournamentId);
    const report = await prisma.resultReport.findUnique({
      where: { id: reportId },
      include: { match: true }
    });

    if (!report) {
      throw new NotFoundError("Report not found.");
    }

    const dbTournament = await this.requireTournament(tournament.id, tournament.guildId, true);
    const snapshot = this.toGeneratedBracket(dbTournament);
    const advancement = this.bracketEngine.advanceMatch(snapshot, report.matchId, {
      winnerRegistrationId: report.proposedWinnerRegistrationId!,
      loserRegistrationId:
        report.match.player1RegistrationId === report.proposedWinnerRegistrationId
          ? report.match.player2RegistrationId!
          : report.match.player1RegistrationId!
    });

    await prisma.$transaction(async (tx) => {
      const freshMatch = await tx.match.findUniqueOrThrow({ where: { id: report.matchId } });
      const updated = await tx.match.updateMany({
        where: { id: report.matchId, version: freshMatch.version },
        data: {
          version: { increment: 1 },
          winnerRegistrationId: advancement.completedMatch.winnerRegistrationId!,
          loserRegistrationId: advancement.completedMatch.loserRegistrationId!,
          completedAt: new Date(),
          status: MatchStatus.COMPLETED,
          lockedAt: null
        }
      });

      if (updated.count !== 1) {
        throw new ConflictError("This match was updated by another action. Please retry.");
      }

      for (const updatedMatch of advancement.updatedMatches.filter((entry) => entry.id !== report.matchId)) {
        await tx.match.update({
          where: { id: updatedMatch.id },
          data: {
            player1RegistrationId: updatedMatch.player1RegistrationId,
            player2RegistrationId: updatedMatch.player2RegistrationId,
            winnerRegistrationId: updatedMatch.winnerRegistrationId,
            loserRegistrationId: updatedMatch.loserRegistrationId,
            status:
              updatedMatch.status === "READY"
                ? MatchStatus.READY
                : updatedMatch.status === "COMPLETED"
                  ? MatchStatus.COMPLETED
                  : MatchStatus.PENDING
          }
        });
      }

      await tx.resultReport.update({
        where: { id: report.id },
        data: { status: MatchStatus.CONFIRMED }
      });
    });

    if (advancement.finalized) {
      const placements = this.bracketEngine.determinePlacements(
        this.toGeneratedBracket(await this.requireTournament(tournament.id, tournament.guildId, true))
      );
      await this.matchRepository.updateTournamentPlacements(tournament.id, placements);
      await this.tournamentRepository.updateTournament(tournament.id, {
        status: TournamentStatus.FINALIZED,
        completedAt: new Date()
      });
    }

    await this.audit({
      tournamentId: tournament.id,
      guildId: tournament.guildId,
      actorUserId,
      action: AuditAction.MATCH_ADVANCED,
      targetType: "Match",
      targetId: report.matchId
    });
    logger.info({ tournamentId, reportId }, "Result applied");
  }

  private toGeneratedBracket(tournament: Awaited<ReturnType<TournamentRepository["getTournament"]>>): GeneratedBracket {
    if (!tournament) {
      throw new NotFoundError("Tournament not found.");
    }

    return {
      format:
        tournament.format === TournamentFormat.DOUBLE_ELIMINATION
          ? "DOUBLE_ELIMINATION"
          : "SINGLE_ELIMINATION",
      placements: [],
      rounds: tournament.brackets.flatMap((bracket) =>
        bracket.rounds.map((round) => ({
          bracketType:
            bracket.type === BracketType.WINNERS
              ? "WINNERS"
              : bracket.type === BracketType.LOSERS
                ? "LOSERS"
                : "GRAND_FINALS",
          roundNumber: round.roundNumber,
          name: round.name,
          matches: round.matches.map((match) => ({
            id: match.id,
            bracketType:
              bracket.type === BracketType.WINNERS
                ? "WINNERS"
                : bracket.type === BracketType.LOSERS
                  ? "LOSERS"
                  : "GRAND_FINALS",
            roundNumber: round.roundNumber,
            sequence: match.sequence,
            bestOf: match.bestOf,
            player1RegistrationId: match.player1RegistrationId,
            player2RegistrationId: match.player2RegistrationId,
            status:
              match.status === MatchStatus.READY
                ? "READY"
                : match.status === MatchStatus.COMPLETED
                  ? "COMPLETED"
                  : "PENDING",
            winnerRegistrationId: match.winnerRegistrationId,
            loserRegistrationId: match.loserRegistrationId,
            nextMatchId: match.nextMatchId,
            nextMatchSlot: (match.nextMatchSlot as 1 | 2 | null) ?? null,
            loserNextMatchId: match.loserNextMatchId,
            loserNextMatchSlot: (match.loserNextMatchSlot as 1 | 2 | null) ?? null,
            resetOfMatchId: match.resetOfMatchId
          }))
        }))
      )
    };
  }

  private async requireTournament(tournamentId: string, guildId?: string, includeRelations = false): Promise<any> {
    const tournament = includeRelations
      ? await this.tournamentRepository.getTournament(tournamentId)
      : await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { settings: true } });

    if (!tournament || (guildId && tournament.guildId !== guildId)) {
      throw new NotFoundError("Tournament not found.");
    }

    return tournament;
  }

  private async audit(args: {
    tournamentId: string;
    guildId: string;
    actorUserId: string;
    action: AuditAction;
    targetType: string;
    targetId: string;
    reason?: string;
  }) {
    await this.tournamentRepository.writeAuditLog({
      tournamentId: args.tournamentId,
      guildId: args.guildId,
      actorUserId: args.actorUserId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      reason: args.reason ? sanitizeUserText(args.reason) : undefined
    });
  }
}
