import { DomainConflictError, DomainValidationError } from "../errors.js";
import type {
  BracketSnapshot,
  BracketSide,
  MatchNode,
  MatchSlot,
  RoundNode
} from "./types.js";

export const makeRoundId = (side: BracketSide, roundNumber: number): string =>
  `${side.toLowerCase()}-round-${roundNumber}`;

export const makeMatchId = (side: BracketSide, roundNumber: number, sequence: number): string =>
  `${side.toLowerCase()}-r${roundNumber}-m${sequence}`;

export const createEmptySlot = (): MatchSlot => ({
  entrantId: null,
  sourceMatchId: null,
  sourceOutcome: null,
  isBye: false
});

export const createMatch = (
  side: BracketSide,
  roundNumber: number,
  sequence: number,
  bestOf: number
): MatchNode => ({
  id: makeMatchId(side, roundNumber, sequence),
  side,
  roundNumber,
  sequence,
  bestOf,
  status: "PENDING",
  slots: [createEmptySlot(), createEmptySlot()],
  winnerId: null,
  loserId: null,
  nextMatchId: null,
  nextMatchSlot: null,
  loserNextMatchId: null,
  loserNextMatchSlot: null,
  resetOfMatchId: null
});

export const createRound = (
  side: BracketSide,
  roundNumber: number,
  matchCount: number,
  bestOf: number
): { round: RoundNode; matches: MatchNode[] } => {
  const matches = Array.from({ length: matchCount }, (_, index) =>
    createMatch(side, roundNumber, index + 1, bestOf)
  );

  return {
    round: {
      id: makeRoundId(side, roundNumber),
      side,
      roundNumber,
      name: `${side.toLowerCase()} round ${roundNumber}`,
      matchIds: matches.map((match) => match.id)
    },
    matches
  };
};

export const cloneSnapshot = (snapshot: BracketSnapshot): BracketSnapshot => ({
  format: snapshot.format,
  championId: snapshot.championId,
  isFinalized: snapshot.isFinalized,
  metadata: { ...snapshot.metadata },
  rounds: snapshot.rounds.map((round) => ({ ...round, matchIds: [...round.matchIds] })),
  matches: Object.fromEntries(
    Object.entries(snapshot.matches).map(([id, match]) => [
      id,
      {
        ...match,
        slots: match.slots.map((slot) => ({ ...slot })) as MatchNode["slots"]
      }
    ])
  )
});

export const refreshMatchState = (match: MatchNode): MatchNode => {
  const [left, right] = match.slots;
  const leftPresent = Boolean(left.entrantId);
  const rightPresent = Boolean(right.entrantId);

  if (match.status === "COMPLETED" || match.status === "CANCELLED") {
    return match;
  }

  if (leftPresent && rightPresent) {
    match.status = "READY";
    return match;
  }

  if (leftPresent && !rightPresent && right.isBye) {
    match.status = "COMPLETED";
    match.winnerId = left.entrantId;
    match.loserId = null;
    return match;
  }

  if (rightPresent && !leftPresent && left.isBye) {
    match.status = "COMPLETED";
    match.winnerId = right.entrantId;
    match.loserId = null;
    return match;
  }

  match.status = "PENDING";
  return match;
};

export const setMatchSlot = (
  match: MatchNode,
  slotIndex: 0 | 1,
  entrantId: string | null,
  sourceMatchId: string | null,
  sourceOutcome: "WINNER" | "LOSER" | null,
  isBye = false
): MatchNode => {
  match.slots[slotIndex] = {
    entrantId,
    sourceMatchId,
    sourceOutcome,
    isBye
  };
  return refreshMatchState(match);
};

export const requireMatch = (snapshot: BracketSnapshot, matchId: string): MatchNode => {
  const match = snapshot.matches[matchId];
  if (!match) {
    throw new DomainValidationError(`Unknown match: ${matchId}`);
  }
  return match;
};

export const validateReport = (match: MatchNode, winnerId: string, loserId: string): void => {
  if (match.status === "COMPLETED") {
    throw new DomainConflictError("This match has already been completed.");
  }

  if (match.status !== "READY") {
    throw new DomainConflictError("This match is not ready to be reported.");
  }

  const entrants = match.slots
    .map((slot) => slot.entrantId)
    .filter((entrantId): entrantId is string => Boolean(entrantId));

  if (!entrants.includes(winnerId) || !entrants.includes(loserId)) {
    throw new DomainValidationError("Submitted players do not match the assigned entrants.");
  }

  if (winnerId === loserId) {
    throw new DomainValidationError("Winner and loser must be different entrants.");
  }
};

export const listEliminationOrder = (snapshot: BracketSnapshot): string[] =>
  Object.values(snapshot.matches)
    .filter((match) => match.status === "COMPLETED" && match.loserId)
    .sort((left, right) => {
      const sideWeight = (side: BracketSide): number =>
        side === "WINNERS" ? 0 : side === "LOSERS" ? 1 : 2;

      if (left.side !== right.side) {
        return sideWeight(left.side) - sideWeight(right.side);
      }
      if (left.roundNumber !== right.roundNumber) {
        return left.roundNumber - right.roundNumber;
      }
      return left.sequence - right.sequence;
    })
    .map((match) => match.loserId!)
    .reverse();
