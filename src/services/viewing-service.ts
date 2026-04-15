import {
  BracketType,
  MatchStatus,
  RegistrationStatus,
  StaffRoleType,
  TournamentStatus
} from "@prisma/client";

import { TournamentRepository } from "../repositories/tournament-repository.js";
import { resolveTournamentBracketSnapshot } from "./support/bracket-snapshot.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

type TournamentWithRelations = NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>;

export interface OverviewView {
  id: string;
  name: string;
  description: string | null;
  status: TournamentStatus;
  format: string;
  bestOf: number;
  activeCount: number;
  checkedInCount: number;
  totalCount: number;
  maxParticipants: number;
  waitlistCount: number;
  requireCheckIn: boolean;
  allowWaitlist: boolean;
  seedingMethod: string;
  pendingReports: number;
  disputedReports: number;
  activeMatches: number;
  completedMatches: number;
  championName: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ParticipantsPageView {
  tournamentId: string;
  tournamentName: string;
  page: number;
  totalPages: number;
  totalCount: number;
  entries: Array<{
    registrationId: string;
    displayName: string;
    seed: number | null;
    status: RegistrationStatus;
    checkedIn: boolean;
    placement: number | null;
  }>;
}

export interface BracketRoundOption {
  label: string;
  value: string;
  description: string;
}

export interface BracketRoundView {
  tournamentId: string;
  tournamentName: string;
  status: TournamentStatus;
  isPreview: boolean;
  selectedSide: BracketType;
  selectedRoundNumber: number;
  roundLabel: string;
  availableRounds: BracketRoundOption[];
  matches: Array<{
    id: string;
    sequence: number;
    status: MatchStatus;
    player1Name: string;
    player2Name: string;
    winnerName: string | null;
    latestScore: string | null;
    latestOutcome: string | null;
  }>;
}

export interface MatchDetailView {
  tournamentId: string;
  tournamentName: string;
  matchId: string;
  status: MatchStatus;
  bracketType: BracketType;
  roundNumber: number;
  sequence: number;
  bestOf: number;
  player1Name: string;
  player2Name: string;
  winnerName: string | null;
  latestScore: string | null;
  latestOutcome: string | null;
  reports: Array<{
    id: string;
    status: MatchStatus;
    outcomeType: string;
    submittedByUserId: string;
    createdAt: Date;
    reason: string | null;
  }>;
}

export interface StaffPanelView {
  tournamentId: string;
  tournamentName: string;
  status: TournamentStatus;
  activeParticipants: number;
  waitlistCount: number;
  pendingReports: number;
  disputedReports: number;
  activeMatches: number;
  completedMatches: number;
  tabs: Array<"overview" | "reports" | "participants">;
  pendingReportItems: Array<{
    reportId: string;
    matchId: string;
    submittedAt: Date;
    submittedByUserId: string;
    status: MatchStatus;
  }>;
  participantStatusCounts: Array<{
    status: RegistrationStatus;
    count: number;
  }>;
}

export class ViewingService {
  public constructor(private readonly tournamentRepository: TournamentRepository) {}

  public async getOverview(guildId: string, tournamentId: string): Promise<OverviewView> {
    const tournament = await this.requireTournament(guildId, tournamentId);
    const activeRegistrations = tournament.registrations.filter(
      (entry) => entry.status === RegistrationStatus.ACTIVE
    );
    const reports = tournament.brackets
      .flatMap((bracket) => bracket.rounds)
      .flatMap((round) => round.matches)
      .flatMap((match) => match.reports);
    const matches = tournament.brackets.flatMap((bracket) => bracket.rounds).flatMap((round) => round.matches);
    const champion = tournament.registrations.find((entry) => entry.placement === 1);

    return {
      id: tournament.id,
      name: tournament.name,
      description: tournament.description,
      status: tournament.status,
      format: tournament.format,
      bestOf: tournament.bestOfDefault,
      activeCount: activeRegistrations.length,
      checkedInCount: activeRegistrations.filter((entry) => entry.checkIn != null).length,
      totalCount: tournament.registrations.length,
      maxParticipants: tournament.maxParticipants,
      waitlistCount: tournament.waitlistEntries.length,
      requireCheckIn: tournament.requireCheckIn,
      allowWaitlist: tournament.allowWaitlist,
      seedingMethod: tournament.settings?.seedingMethod ?? "RANDOM",
      pendingReports: reports.filter((entry) => entry.status === MatchStatus.AWAITING_CONFIRMATION).length,
      disputedReports: reports.filter((entry) => entry.status === MatchStatus.DISPUTED).length,
      activeMatches: matches.filter(
        (entry) =>
          entry.status === MatchStatus.READY ||
          entry.status === MatchStatus.AWAITING_CONFIRMATION ||
          entry.status === MatchStatus.DISPUTED
      ).length,
      completedMatches: matches.filter((entry) => entry.status === MatchStatus.COMPLETED).length,
      championName: champion?.participant.displayName ?? null,
      startedAt: tournament.startedAt,
      completedAt: tournament.completedAt
    };
  }

  public async getParticipantsPage(
    guildId: string,
    tournamentId: string,
    page: number,
    pageSize = 10
  ): Promise<ParticipantsPageView> {
    const tournament = await this.requireTournament(guildId, tournamentId);
    const ordered = [...tournament.registrations].sort((left, right) => {
      const leftSeed = left.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
      const rightSeed = right.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftSeed !== rightSeed) return leftSeed - rightSeed;
      return left.joinedAt.getTime() - right.joinedAt.getTime();
    });

    const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const entries = ordered.slice(startIndex, startIndex + pageSize).map((entry) => ({
      registrationId: entry.id,
      displayName: entry.participant.displayName,
      seed: entry.seed?.seedNumber ?? null,
      status: entry.status,
      checkedIn: entry.checkIn != null,
      placement: entry.placement ?? null
    }));

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      page: safePage,
      totalPages,
      totalCount: ordered.length,
      entries
    };
  }

  public async getBracketRound(
    guildId: string,
    tournamentId: string,
    bracketType?: BracketType,
    roundNumber?: number
  ): Promise<BracketRoundView> {
    const tournament = await this.requireTournament(guildId, tournamentId);
    const { snapshot, mode } = resolveTournamentBracketSnapshot(tournament);

    if (!snapshot) {
      throw new ValidationError("Bracket preview becomes available once at least two eligible entrants have joined.");
    }

    const registrationById = new Map(
      tournament.registrations.map((entry) => [entry.id, entry.participant.displayName] as const)
    );
    const persistedMatchById = new Map(
      tournament.brackets
        .flatMap((bracket) => bracket.rounds)
        .flatMap((round) => round.matches)
        .map((match) => [match.id, match] as const)
    );
    const rounds = snapshot.rounds.map((round) => ({
      bracketType: this.sideToBracketType(round.side),
      roundNumber: round.roundNumber,
      roundName: round.name,
      matches: round.matchIds.map((matchId) => snapshot.matches[matchId]!)
    }));

    const availableRounds = rounds
      .sort((left, right) => this.bracketOrder(left.bracketType) - this.bracketOrder(right.bracketType) || left.roundNumber - right.roundNumber)
      .map((round) => ({
        label: `${this.prettyBracketType(round.bracketType)} ${round.roundNumber}`,
        value: `${round.bracketType}:${round.roundNumber}`,
        description: `${round.matches.length} match${round.matches.length === 1 ? "" : "es"}`
      }));

    const selected =
      rounds.find(
        (round) =>
          round.bracketType === (bracketType ?? rounds[0]!.bracketType) &&
          round.roundNumber === (roundNumber ?? rounds[0]!.roundNumber)
      ) ?? rounds[0]!;

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      status: tournament.status,
      isPreview: mode === "PREVIEW",
      selectedSide: selected.bracketType,
      selectedRoundNumber: selected.roundNumber,
      roundLabel: `${this.prettyBracketType(selected.bracketType)} Round ${selected.roundNumber}`,
      availableRounds,
      matches: selected.matches.map((match) => {
        const persistedMatch = persistedMatchById.get(match.id);
        const latestReport = persistedMatch
          ? [...persistedMatch.reports].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0]
          : null;

        return {
          id: match.id,
          sequence: match.sequence,
          status: this.domainMatchStatusToView(match.status),
          player1Name: registrationById.get(match.slots[0].entrantId ?? "") ?? "TBD",
          player2Name: registrationById.get(match.slots[1].entrantId ?? "") ?? "TBD",
          winnerName: registrationById.get(match.winnerId ?? "") ?? null,
          latestScore:
            latestReport?.player1Score != null && latestReport.player2Score != null
              ? `${latestReport.player1Score}-${latestReport.player2Score}`
              : null,
          latestOutcome: latestReport?.outcomeType ?? (match.winnerId ? "ADVANCED" : null)
        };
      })
    };
  }

  public async getMatchDetail(
    guildId: string,
    tournamentId: string,
    matchId: string
  ): Promise<MatchDetailView> {
    const tournament = await this.requireTournament(guildId, tournamentId);
    const roundRecord = tournament.brackets.flatMap((bracket) =>
      bracket.rounds.map((round) => ({
        bracketType: bracket.type,
        roundNumber: round.roundNumber,
        match: round.matches.find((entry) => entry.id === matchId) ?? null
      }))
    ).find((entry) => entry.match != null);

    if (!roundRecord?.match) {
      throw new NotFoundError("Match not found for this tournament.");
    }

    const registrationById = new Map(
      tournament.registrations.map((entry) => [entry.id, entry.participant.displayName] as const)
    );
    const latestReport = [...roundRecord.match.reports].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    )[0];

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      matchId: roundRecord.match.id,
      status: roundRecord.match.status,
      bracketType: roundRecord.bracketType,
      roundNumber: roundRecord.roundNumber,
      sequence: roundRecord.match.sequence,
      bestOf: roundRecord.match.bestOf,
      player1Name: registrationById.get(roundRecord.match.player1RegistrationId ?? "") ?? "TBD",
      player2Name: registrationById.get(roundRecord.match.player2RegistrationId ?? "") ?? "TBD",
      winnerName: registrationById.get(roundRecord.match.winnerRegistrationId ?? "") ?? null,
      latestScore:
        latestReport?.player1Score != null && latestReport.player2Score != null
          ? `${latestReport.player1Score}-${latestReport.player2Score}`
          : null,
      latestOutcome: latestReport?.outcomeType ?? null,
      reports: [...roundRecord.match.reports]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, 5)
        .map((report) => ({
          id: report.id,
          status: report.status,
          outcomeType: report.outcomeType,
          submittedByUserId: report.submittedByUserId,
          createdAt: report.createdAt,
          reason: report.reason
        }))
    };
  }

  public async getStaffPanel(
    guildId: string,
    tournamentId: string,
    _minimumRole: StaffRoleType
  ): Promise<StaffPanelView> {
    const tournament = await this.requireTournament(guildId, tournamentId);
    const matches = tournament.brackets.flatMap((bracket) => bracket.rounds).flatMap((round) => round.matches);
    const reports = matches.flatMap((match) => match.reports);
    const pendingReports = reports
      .filter(
        (entry) =>
          entry.status === MatchStatus.AWAITING_CONFIRMATION || entry.status === MatchStatus.DISPUTED
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    const participantStatusCounts = [
      RegistrationStatus.ACTIVE,
      RegistrationStatus.ELIMINATED,
      RegistrationStatus.DROPPED,
      RegistrationStatus.DISQUALIFIED,
      RegistrationStatus.WITHDRAWN
    ].map((status) => ({
      status,
      count: tournament.registrations.filter((entry) => entry.status === status).length
    }));

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      status: tournament.status,
      activeParticipants: tournament.registrations.filter(
        (entry) => entry.status === RegistrationStatus.ACTIVE
      ).length,
      waitlistCount: tournament.waitlistEntries.length,
      pendingReports: pendingReports.filter(
        (entry) => entry.status === MatchStatus.AWAITING_CONFIRMATION
      ).length,
      disputedReports: pendingReports.filter((entry) => entry.status === MatchStatus.DISPUTED).length,
      activeMatches: matches.filter(
        (entry) =>
          entry.status === MatchStatus.READY ||
          entry.status === MatchStatus.AWAITING_CONFIRMATION ||
          entry.status === MatchStatus.DISPUTED
      ).length,
      completedMatches: matches.filter((entry) => entry.status === MatchStatus.COMPLETED).length,
      tabs: ["overview", "reports", "participants"],
      pendingReportItems: pendingReports.slice(0, 8).map((entry) => ({
        reportId: entry.id,
        matchId: entry.matchId,
        submittedAt: entry.createdAt,
        submittedByUserId: entry.submittedByUserId,
        status: entry.status
      })),
      participantStatusCounts
    };
  }

  public async getWaitlistPage(
    guildId: string,
    tournamentId: string,
    page: number,
    pageSize = 10
  ): Promise<ParticipantsPageView> {
    const tournament = await this.requireTournament(guildId, tournamentId);
    const ordered = [...tournament.waitlistEntries].sort((left, right) => left.position - right.position);
    const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const entries = ordered.slice(startIndex, startIndex + pageSize).map((entry) => ({
      registrationId: entry.id,
      displayName: entry.participant.displayName,
      seed: null,
      status: RegistrationStatus.WAITLISTED,
      checkedIn: false,
      placement: null
    }));

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      page: safePage,
      totalPages,
      totalCount: ordered.length,
      entries
    };
  }

  private async requireTournament(guildId: string, tournamentId: string): Promise<TournamentWithRelations> {
    const tournament = await this.tournamentRepository.getTournament(tournamentId);
    if (!tournament || tournament.guildId !== guildId) {
      throw new NotFoundError("Tournament not found.");
    }
    return tournament;
  }

  private prettyBracketType(value: BracketType): string {
    if (value === BracketType.WINNERS) return "Winners";
    if (value === BracketType.LOSERS) return "Losers";
    return "Grand Finals";
  }

  private bracketOrder(value: BracketType): number {
    if (value === BracketType.WINNERS) return 0;
    if (value === BracketType.LOSERS) return 1;
    return 2;
  }

  private sideToBracketType(side: "WINNERS" | "LOSERS" | "GRAND_FINALS"): BracketType {
    if (side === "WINNERS") return BracketType.WINNERS;
    if (side === "LOSERS") return BracketType.LOSERS;
    return BracketType.GRAND_FINALS;
  }

  private domainMatchStatusToView(status: "PENDING" | "READY" | "COMPLETED" | "CANCELLED"): MatchStatus {
    if (status === "COMPLETED") return MatchStatus.COMPLETED;
    if (status === "READY") return MatchStatus.READY;
    if (status === "CANCELLED") return MatchStatus.CANCELLED;
    return MatchStatus.PENDING;
  }
}
