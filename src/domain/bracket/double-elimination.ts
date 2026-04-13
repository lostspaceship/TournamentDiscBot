import { DomainValidationError } from "../errors.js";
import { BaseBracketEngine } from "./base-engine.js";
import { createRound, makeMatchId, refreshMatchState, setMatchSlot } from "./helpers.js";
import { nextPowerOfTwo, padSeededEntrants } from "./seeding.js";
import type { BracketSnapshot, GenerateBracketInput, MatchNode } from "./types.js";

export class DoubleEliminationEngine extends BaseBracketEngine {
  public readonly format = "DOUBLE_ELIMINATION" as const;

  public generate(input: GenerateBracketInput): BracketSnapshot {
    if (input.entrants.length < 2) {
      throw new DomainValidationError("Double elimination requires at least two entrants.");
    }

    const seeded = padSeededEntrants(input.entrants);
    const bracketSize = nextPowerOfTwo(Math.max(2, input.entrants.length));
    const winnerRounds = Math.log2(bracketSize);
    const rounds: BracketSnapshot["rounds"] = [];
    const matches: BracketSnapshot["matches"] = {};

    for (let roundNumber = 1; roundNumber <= winnerRounds; roundNumber += 1) {
      const { round, matches: roundMatches } = createRound(
        "WINNERS",
        roundNumber,
        bracketSize / 2 ** roundNumber,
        input.bestOf
      );
      rounds.push(round);
      for (const match of roundMatches) {
        matches[match.id] = match;
      }
    }

    for (let roundNumber = 1; roundNumber <= Math.max(0, winnerRounds - 1) * 2; roundNumber += 1) {
      const matchCount =
        roundNumber % 2 === 1
          ? bracketSize / 2 ** Math.floor((roundNumber + 3) / 2)
          : bracketSize / 2 ** Math.floor((roundNumber + 4) / 2);
      const { round, matches: roundMatches } = createRound(
        "LOSERS",
        roundNumber,
        Math.max(1, matchCount),
        input.bestOf
      );
      rounds.push(round);
      for (const match of roundMatches) {
        matches[match.id] = match;
      }
    }

    const { round: grandFinalRound, matches: grandFinalMatches } = createRound("GRAND_FINALS", 1, 1, input.bestOf);
    rounds.push(grandFinalRound);
    for (const match of grandFinalMatches) {
      matches[match.id] = match;
    }

    if (input.grandFinalResetEnabled ?? true) {
      const { round: resetRound, matches: resetMatches } = createRound("GRAND_FINALS", 2, 1, input.bestOf);
      rounds.push(resetRound);
      for (const match of resetMatches) {
        matches[match.id] = match;
      }
      matches[makeMatchId("GRAND_FINALS", 1, 1)]!.nextMatchId = makeMatchId("GRAND_FINALS", 2, 1);
      matches[makeMatchId("GRAND_FINALS", 1, 1)]!.nextMatchSlot = 0;
      matches[makeMatchId("GRAND_FINALS", 2, 1)]!.resetOfMatchId = makeMatchId("GRAND_FINALS", 1, 1);
    }

    for (let index = 0; index < seeded.length / 2; index += 1) {
      const match = matches[makeMatchId("WINNERS", 1, index + 1)]!;
      const left = seeded[index * 2];
      const right = seeded[index * 2 + 1];
      setMatchSlot(match, 0, left?.id ?? null, null, null, left === null);
      setMatchSlot(match, 1, right?.id ?? null, null, null, right === null);
    }

    for (let roundNumber = 1; roundNumber < winnerRounds; roundNumber += 1) {
      const currentMatchCount = bracketSize / 2 ** roundNumber;
      for (let sequence = 1; sequence <= currentMatchCount; sequence += 1) {
        const winnersMatch = matches[makeMatchId("WINNERS", roundNumber, sequence)]!;
        const nextWinnersMatch = matches[makeMatchId("WINNERS", roundNumber + 1, Math.floor((sequence + 1) / 2))]!;
        winnersMatch.nextMatchId = nextWinnersMatch.id;
        winnersMatch.nextMatchSlot = sequence % 2 === 1 ? 0 : 1;
      }
    }

    for (let sequence = 1; sequence <= bracketSize / 2; sequence += 1) {
      const winnersRoundOne = matches[makeMatchId("WINNERS", 1, sequence)]!;
      const target = matches[makeMatchId("LOSERS", 1, Math.floor((sequence + 1) / 2))]!;
      winnersRoundOne.loserNextMatchId = target.id;
      winnersRoundOne.loserNextMatchSlot = sequence % 2 === 1 ? 0 : 1;
    }

    for (let winnersRound = 2; winnersRound < winnerRounds; winnersRound += 1) {
      const winnersMatchCount = bracketSize / 2 ** winnersRound;
      for (let sequence = 1; sequence <= winnersMatchCount; sequence += 1) {
        const winnersMatch = matches[makeMatchId("WINNERS", winnersRound, sequence)]!;
        const target = matches[makeMatchId("LOSERS", winnersRound * 2 - 1, sequence)]!;
        winnersMatch.loserNextMatchId = target.id;
        winnersMatch.loserNextMatchSlot = 1;
      }
    }

    for (let losersRound = 1; losersRound < Math.max(0, winnerRounds - 1) * 2; losersRound += 1) {
      const round = rounds.find((entry) => entry.side === "LOSERS" && entry.roundNumber === losersRound)!;

      if (losersRound % 2 === 1) {
        round.matchIds.forEach((matchId, index) => {
          const match = matches[matchId]!;
          const next = matches[makeMatchId("LOSERS", losersRound + 1, index + 1)]!;
          match.nextMatchId = next.id;
          match.nextMatchSlot = 0;
        });
        continue;
      }

      round.matchIds.forEach((matchId, index) => {
        const match = matches[matchId]!;
        const next = matches[makeMatchId("LOSERS", losersRound + 1, Math.floor(index / 2) + 1)];
        if (!next) {
          return;
        }
        match.nextMatchId = next.id;
        match.nextMatchSlot = index % 2 === 0 ? 0 : 1;
      });
    }

    const winnersFinal = matches[makeMatchId("WINNERS", winnerRounds, 1)]!;
    const losersFinal = matches[makeMatchId("LOSERS", Math.max(1, (winnerRounds - 1) * 2), 1)]!;
    const grandFinal = matches[makeMatchId("GRAND_FINALS", 1, 1)]!;

    winnersFinal.nextMatchId = grandFinal.id;
    winnersFinal.nextMatchSlot = 0;
    winnersFinal.loserNextMatchId = losersFinal.id;
    winnersFinal.loserNextMatchSlot = 1;
    losersFinal.nextMatchId = grandFinal.id;
    losersFinal.nextMatchSlot = 1;

    Object.values(matches).forEach(refreshMatchState);

    const snapshot: BracketSnapshot = {
      format: this.format,
      rounds,
      matches,
      championId: null,
      isFinalized: false,
      metadata: {
        hasGrandFinalReset: input.grandFinalResetEnabled ?? true,
        initialEntrantCount: input.entrants.length,
        bracketSize
      }
    };

    this.propagateAutoWins(snapshot, new Set<string>());
    this.resolveFinalization(snapshot, grandFinal, new Set<string>());
    return snapshot;
  }

  protected routeWinner(snapshot: BracketSnapshot, match: MatchNode, changedMatchIds: Set<string>): void {
    if (!match.nextMatchId || match.nextMatchSlot == null || !match.winnerId) {
      return;
    }

    if (
      match.side === "GRAND_FINALS" &&
      match.roundNumber === 1 &&
      snapshot.metadata.hasGrandFinalReset
    ) {
      if (match.slots[1].entrantId === match.winnerId) {
        const resetMatch = snapshot.matches[match.nextMatchId];
        if (!resetMatch) {
          return;
        }

        setMatchSlot(resetMatch, 0, match.slots[0].entrantId, match.id, "WINNER");
        setMatchSlot(resetMatch, 1, match.slots[1].entrantId, match.id, "WINNER");
        changedMatchIds.add(resetMatch.id);
      }

      return;
    }

    const nextMatch = snapshot.matches[match.nextMatchId];
    if (!nextMatch) {
      return;
    }

    setMatchSlot(nextMatch, match.nextMatchSlot, match.winnerId, match.id, "WINNER");
    changedMatchIds.add(nextMatch.id);
  }

  protected routeLoser(snapshot: BracketSnapshot, match: MatchNode, changedMatchIds: Set<string>): void {
    if (!match.loserId || !match.loserNextMatchId || match.loserNextMatchSlot == null) {
      return;
    }

    const nextMatch = snapshot.matches[match.loserNextMatchId];
    if (!nextMatch) {
      return;
    }

    setMatchSlot(nextMatch, match.loserNextMatchSlot, match.loserId, match.id, "LOSER");
    changedMatchIds.add(nextMatch.id);
  }

  protected resolveFinalization(snapshot: BracketSnapshot, completedMatch: MatchNode, _changedMatchIds: Set<string>): void {
    const grandFinals = Object.values(snapshot.matches)
      .filter((match) => match.side === "GRAND_FINALS")
      .sort((left, right) => left.roundNumber - right.roundNumber);

    const firstGrandFinal = grandFinals[0];
    const lastGrandFinal = grandFinals.at(-1);

    if (
      snapshot.metadata.hasGrandFinalReset &&
      firstGrandFinal?.status === "COMPLETED" &&
      firstGrandFinal.winnerId &&
      firstGrandFinal.winnerId === firstGrandFinal.slots[0].entrantId
    ) {
      snapshot.championId = firstGrandFinal.winnerId;
      snapshot.isFinalized = true;
      return;
    }

    if (lastGrandFinal?.status === "COMPLETED" && lastGrandFinal.winnerId) {
      snapshot.championId = lastGrandFinal.winnerId;
      snapshot.isFinalized = true;
      return;
    }

    if (
      !snapshot.metadata.hasGrandFinalReset &&
      completedMatch.side === "GRAND_FINALS" &&
      completedMatch.status === "COMPLETED" &&
      completedMatch.winnerId
    ) {
      snapshot.championId = completedMatch.winnerId;
      snapshot.isFinalized = true;
    }
  }
}
