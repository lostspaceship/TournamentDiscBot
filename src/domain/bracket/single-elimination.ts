import { DomainValidationError } from "../errors.js";
import { BaseBracketEngine } from "./base-engine.js";
import { createRound, makeMatchId, refreshMatchState, setMatchSlot } from "./helpers.js";
import { padSeededEntrants } from "./seeding.js";
import type { BracketSnapshot, GenerateBracketInput, MatchNode } from "./types.js";

export class SingleEliminationEngine extends BaseBracketEngine {
  public readonly format = "SINGLE_ELIMINATION" as const;

  public generate(input: GenerateBracketInput): BracketSnapshot {
    if (input.entrants.length < 2) {
      throw new DomainValidationError("Single elimination requires at least two entrants.");
    }

    const seeded = padSeededEntrants(input.entrants);
    const bracketSize = seeded.length;
    const rounds: BracketSnapshot["rounds"] = [];
    const matches: BracketSnapshot["matches"] = {};
    const roundCount = Math.log2(bracketSize);

    for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
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

    for (let index = 0; index < seeded.length / 2; index += 1) {
      const match = matches[makeMatchId("WINNERS", 1, index + 1)]!;
      const left = seeded[index * 2];
      const right = seeded[index * 2 + 1];
      setMatchSlot(match, 0, left?.id ?? null, null, null, left === null);
      setMatchSlot(match, 1, right?.id ?? null, null, null, right === null);
    }

    for (let roundNumber = 1; roundNumber < roundCount; roundNumber += 1) {
      const currentMatchCount = bracketSize / 2 ** roundNumber;
      for (let sequence = 1; sequence <= currentMatchCount; sequence += 1) {
        const match = matches[makeMatchId("WINNERS", roundNumber, sequence)]!;
        const nextMatch = matches[makeMatchId("WINNERS", roundNumber + 1, Math.floor((sequence + 1) / 2))]!;
        match.nextMatchId = nextMatch.id;
        match.nextMatchSlot = sequence % 2 === 1 ? 0 : 1;
      }
    }

    Object.values(matches).forEach(refreshMatchState);

    const snapshot: BracketSnapshot = {
      format: this.format,
      rounds,
      matches,
      championId: null,
      isFinalized: false,
      metadata: {
        hasGrandFinalReset: false,
        initialEntrantCount: input.entrants.length,
        bracketSize
      }
    };

    this.propagateAutoWins(snapshot, new Set<string>());
    this.resolveFinalization(snapshot, Object.values(matches)[0]!, new Set<string>());
    return snapshot;
  }

  protected routeWinner(snapshot: BracketSnapshot, match: MatchNode, changedMatchIds: Set<string>): void {
    if (!match.nextMatchId || match.nextMatchSlot == null || !match.winnerId) {
      return;
    }

    const nextMatch = snapshot.matches[match.nextMatchId];
    if (!nextMatch) {
      return;
    }

    setMatchSlot(nextMatch, match.nextMatchSlot, match.winnerId, match.id, "WINNER");
    changedMatchIds.add(nextMatch.id);
  }

  protected routeLoser(): void {}

  protected resolveFinalization(snapshot: BracketSnapshot, _completedMatch: MatchNode, _changedMatchIds: Set<string>): void {
    const terminal = Object.values(snapshot.matches).find((match) => match.nextMatchId === null);
    if (terminal?.status === "COMPLETED" && terminal.winnerId) {
      snapshot.championId = terminal.winnerId;
      snapshot.isFinalized = true;
    }
  }
}
