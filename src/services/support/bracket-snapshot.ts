import {
  BracketType,
  MatchStatus,
  RegistrationStatus,
  SeedingMethod,
  TournamentFormat,
  TournamentStatus
} from "@prisma/client";

import { BracketEngineFactory } from "../../domain/bracket/engine.js";
import { seedEntrants } from "../../domain/bracket/seeding.js";
import type {
  BracketSnapshot,
  MatchNode,
  RoundNode,
  SeededEntrant
} from "../../domain/bracket/types.js";
import type { TournamentRepository } from "../../repositories/tournament-repository.js";

export type TournamentWithBracketData = NonNullable<
  Awaited<ReturnType<TournamentRepository["getTournament"]>>
>;

export interface TournamentBracketSnapshotResult {
  snapshot: BracketSnapshot | null;
  mode: "OFFICIAL" | "PREVIEW" | "NONE";
}

export const getEligibleRegistrationsForBracket = (
  tournament: TournamentWithBracketData
) => {
  const activeRegistrations = tournament.registrations.filter(
    (entry) => entry.status === RegistrationStatus.ACTIVE
  );

  return tournament.requireCheckIn
    ? activeRegistrations.filter((entry) => entry.checkIn != null)
    : activeRegistrations;
};

export const buildSeededRegistrations = (
  tournament: TournamentWithBracketData
): Array<SeededEntrant & { id: string }> => {
  const eligibleRegistrations = getEligibleRegistrationsForBracket(tournament);
  const method = tournament.settings?.seedingMethod ?? SeedingMethod.RANDOM;
  const entrants = eligibleRegistrations.map((entry) => ({
    id: entry.id,
    seed: entry.seed?.seedNumber ?? undefined,
    rating: entry.participant.rating ?? undefined,
    metadata: {
      participantId: entry.participantId,
      joinedAt: entry.joinedAt.toISOString()
    }
  }));

  const seeded = seedEntrants(entrants, {
    method,
    randomSeed: eligibleRegistrations.map((entry) => entry.id).join(":")
  });

  return seeded.map((entry) => ({ ...entry, id: entry.id }));
};

export const buildPersistedSnapshotFromTournament = (
  tournament: TournamentWithBracketData
): BracketSnapshot => {
  const rounds: RoundNode[] = [];
  const matches: Record<string, MatchNode> = {};

  for (const bracket of tournament.brackets) {
    for (const round of bracket.rounds) {
      rounds.push({
        id: round.id,
        side: bracketTypeToSide(bracket.type),
        roundNumber: round.roundNumber,
        name: round.name,
        matchIds: round.matches.map((match) => match.id)
      });

      for (const match of round.matches) {
        matches[match.id] = {
          id: match.id,
          side: bracketTypeToSide(match.bracketType),
          roundNumber: round.roundNumber,
          sequence: match.sequence,
          bestOf: match.bestOf,
          status: matchStatusToDomain(match.status),
          slots: [
            {
              entrantId: match.player1RegistrationId,
              sourceMatchId: null,
              sourceOutcome: null,
              isBye: false
            },
            {
              entrantId: match.player2RegistrationId,
              sourceMatchId: null,
              sourceOutcome: null,
              isBye: false
            }
          ],
          winnerId: match.winnerRegistrationId,
          loserId: match.loserRegistrationId,
          nextMatchId: match.nextMatchId,
          nextMatchSlot: toDomainSlot(match.nextMatchSlot),
          loserNextMatchId: match.loserNextMatchId,
          loserNextMatchSlot: toDomainSlot(match.loserNextMatchSlot),
          resetOfMatchId: match.resetOfMatchId
        };
      }
    }
  }

  for (const match of Object.values(matches)) {
    if (match.nextMatchId != null && match.nextMatchSlot != null) {
      const nextMatch = matches[match.nextMatchId];
      if (nextMatch) {
        nextMatch.slots[match.nextMatchSlot] = {
          ...nextMatch.slots[match.nextMatchSlot],
          sourceMatchId: match.id,
          sourceOutcome: "WINNER",
          isBye: false
        };
      }
    }

    if (match.loserNextMatchId != null && match.loserNextMatchSlot != null) {
      const loserNextMatch = matches[match.loserNextMatchId];
      if (loserNextMatch) {
        loserNextMatch.slots[match.loserNextMatchSlot] = {
          ...loserNextMatch.slots[match.loserNextMatchSlot],
          sourceMatchId: match.id,
          sourceOutcome: "LOSER",
          isBye: false
        };
      }
    }
  }

  for (const match of Object.values(matches)) {
    for (const slot of match.slots) {
      const unresolvedFeed = slot.sourceMatchId != null;
      slot.isBye = !unresolvedFeed && slot.entrantId == null;
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
};

export const resolveTournamentBracketSnapshot = (
  tournament: TournamentWithBracketData
): TournamentBracketSnapshotResult => {
  if (tournament.brackets.length > 0) {
    return {
      snapshot: buildPersistedSnapshotFromTournament(tournament),
      mode: "OFFICIAL"
    };
  }

  const eligibleRegistrations = getEligibleRegistrationsForBracket(tournament);
  if (eligibleRegistrations.length < 2) {
    return {
      snapshot: null,
      mode: "NONE"
    };
  }

  const seededEntrants = buildSeededRegistrations(tournament);
  const engine = BracketEngineFactory.create(
    tournament.format === TournamentFormat.DOUBLE_ELIMINATION
      ? "DOUBLE_ELIMINATION"
      : "SINGLE_ELIMINATION"
  );

  return {
    snapshot: engine.generate({
      entrants: seededEntrants,
      bestOf: tournament.bestOfDefault,
      grandFinalResetEnabled: tournament.settings?.grandFinalResetEnabled ?? true
    }),
    mode: "PREVIEW"
  };
};

const bracketTypeToSide = (bracketType: BracketType): MatchNode["side"] => {
  if (bracketType === BracketType.WINNERS) return "WINNERS";
  if (bracketType === BracketType.LOSERS) return "LOSERS";
  return "GRAND_FINALS";
};

const matchStatusToDomain = (status: MatchStatus): MatchNode["status"] => {
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
};

const toDomainSlot = (value: number | null): 0 | 1 | null => {
  if (value == null) return null;
  if (value === 0 || value === 1) return value;
  throw new Error("Stored match slot link is invalid.");
};
