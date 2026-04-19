import { DomainValidationError } from "../errors.js";
import { BaseBracketEngine } from "./base-engine.js";
import { createRound, makeMatchId, refreshMatchState, setMatchSlot } from "./helpers.js";
import { createSeedOrder } from "./seeding.js";
import type { BracketSnapshot, GenerateBracketInput, MatchNode } from "./types.js";

export class SingleEliminationEngine extends BaseBracketEngine {
  public readonly format = "SINGLE_ELIMINATION" as const;

  public generate(input: GenerateBracketInput): BracketSnapshot {
    if (input.entrants.length < 2) {
      throw new DomainValidationError("Single elimination requires at least two entrants.");
    }

    const seeded = [...input.entrants].sort((left, right) => left.seed - right.seed);
    const entrantCount = seeded.length;
    const bracketSize = highestPowerOfTwoAtMost(entrantCount);
    const playInMatchCount = Math.max(0, entrantCount - bracketSize);
    const directEntryCount = bracketSize - playInMatchCount;
    const playInRoundOffset = playInMatchCount > 0 ? 1 : 0;
    const rounds: BracketSnapshot["rounds"] = [];
    const matches: BracketSnapshot["matches"] = {};
    const roundCount = Math.log2(bracketSize);

    if (playInMatchCount > 0) {
      const { round, matches: roundMatches } = createRound("WINNERS", 1, playInMatchCount, input.bestOf);
      round.name = "Play-In";
      rounds.push(round);
      for (const match of roundMatches) {
        matches[match.id] = match;
      }
    }

    for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
      const { round, matches: roundMatches } = createRound(
        "WINNERS",
        roundNumber + playInRoundOffset,
        bracketSize / 2 ** roundNumber,
        input.bestOf
      );
      rounds.push(round);
      for (const match of roundMatches) {
        matches[match.id] = match;
      }
    }

    const entrantsBySeed = new Map(seeded.map((entrant) => [entrant.seed, entrant] as const));
    const mainRoundSeedOrder = createSeedOrder(bracketSize);
    const playInMatchIdByMainSeed = new Map<number, string>();
    const playInSeedsInBracketOrder = mainRoundSeedOrder.filter(
      (seed, index) =>
        seed > directEntryCount &&
        mainRoundSeedOrder.indexOf(seed) === index
    );

    if (playInMatchCount > 0) {
      for (let index = 0; index < playInMatchCount; index += 1) {
        const mainSeed = playInSeedsInBracketOrder[index]!;
        const opposingSeed = entrantCount - (mainSeed - directEntryCount - 1);
        const playInMatch = matches[makeMatchId("WINNERS", 1, index + 1)]!;
        const left = entrantsBySeed.get(mainSeed) ?? null;
        const right = entrantsBySeed.get(opposingSeed) ?? null;
        setMatchSlot(playInMatch, 0, left?.id ?? null, null, null, false);
        setMatchSlot(playInMatch, 1, right?.id ?? null, null, null, false);
        playInMatchIdByMainSeed.set(mainSeed, playInMatch.id);
      }
    }

    for (let index = 0; index < mainRoundSeedOrder.length / 2; index += 1) {
      const match = matches[makeMatchId("WINNERS", 1 + playInRoundOffset, index + 1)]!;
      const leftSeed = mainRoundSeedOrder[index * 2]!;
      const rightSeed = mainRoundSeedOrder[index * 2 + 1]!;
      const leftPlayInMatchId = this.assignMainBracketSlot(
        match,
        0,
        leftSeed,
        directEntryCount,
        entrantsBySeed,
        playInMatchIdByMainSeed
      );
      const rightPlayInMatchId = this.assignMainBracketSlot(
        match,
        1,
        rightSeed,
        directEntryCount,
        entrantsBySeed,
        playInMatchIdByMainSeed
      );

      if (leftPlayInMatchId) {
        const playInMatch = matches[leftPlayInMatchId]!;
        playInMatch.nextMatchId = match.id;
        playInMatch.nextMatchSlot = 0;
      }

      if (rightPlayInMatchId) {
        const playInMatch = matches[rightPlayInMatchId]!;
        playInMatch.nextMatchId = match.id;
        playInMatch.nextMatchSlot = 1;
      }
    }

    for (let roundNumber = 1 + playInRoundOffset; roundNumber < roundCount + playInRoundOffset; roundNumber += 1) {
      const logicalRoundNumber = roundNumber - playInRoundOffset;
      for (let sequence = 1; sequence <= bracketSize / 2 ** logicalRoundNumber; sequence += 1) {
        const match = matches[makeMatchId("WINNERS", roundNumber, sequence)]!;
        const nextMatch = matches[makeMatchId("WINNERS", roundNumber + 1, Math.floor((sequence + 1) / 2))]!;
        match.nextMatchId = nextMatch.id;
        match.nextMatchSlot = sequence % 2 === 1 ? 0 : 1;
        if (nextMatch.slots[match.nextMatchSlot].entrantId == null) {
          setMatchSlot(nextMatch, match.nextMatchSlot, null, match.id, "WINNER", false);
        }
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

  private assignMainBracketSlot(
    match: MatchNode,
    slotIndex: 0 | 1,
    mainSeed: number,
    directEntryCount: number,
    entrantsBySeed: Map<number, GenerateBracketInput["entrants"][number]>,
    playInMatchIdByMainSeed: Map<number, string>
  ): string | null {
    if (mainSeed <= directEntryCount) {
      const entrant = entrantsBySeed.get(mainSeed) ?? null;
      setMatchSlot(match, slotIndex, entrant?.id ?? null, null, null, false);
      return null;
    }

    const playInMatchId = playInMatchIdByMainSeed.get(mainSeed) ?? null;
    setMatchSlot(match, slotIndex, null, playInMatchId, playInMatchId ? "WINNER" : null, false);
    return playInMatchId;
  }
}

const highestPowerOfTwoAtMost = (value: number): number => {
  let current = 1;
  while (current * 2 <= value) {
    current *= 2;
  }

  return Math.max(2, current);
};
