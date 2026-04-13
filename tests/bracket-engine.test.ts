import { describe, expect, it } from "vitest";

import { DomainConflictError, DomainValidationError } from "../src/domain/errors.js";
import { BracketEngineFactory } from "../src/domain/bracket/engine.js";
import type { BracketSnapshot, MatchNode, SeededEntrant } from "../src/domain/bracket/types.js";

const entrants = (count: number): SeededEntrant[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    seed: index + 1
  }));

const findMatch = (
  snapshot: BracketSnapshot,
  side: MatchNode["side"],
  roundNumber: number,
  sequence: number
): MatchNode => {
  const match = Object.values(snapshot.matches).find(
    (entry) => entry.side === side && entry.roundNumber === roundNumber && entry.sequence === sequence
  );

  expect(match).toBeDefined();
  return match!;
};

const playMatch = (
  engine: ReturnType<typeof BracketEngineFactory.create>,
  snapshot: BracketSnapshot,
  side: MatchNode["side"],
  roundNumber: number,
  sequence: number,
  winnerId?: string
) => {
  const match = findMatch(snapshot, side, roundNumber, sequence);
  const activeEntrants = match.slots
    .map((slot) => slot.entrantId)
    .filter((entrantId): entrantId is string => Boolean(entrantId));

  expect(activeEntrants).toHaveLength(2);
  const resolvedWinner = winnerId ?? activeEntrants[0]!;
  const resolvedLoser = activeEntrants.find((entrantId) => entrantId !== resolvedWinner)!;

  return engine.advance(snapshot, {
    matchId: match.id,
    winnerId: resolvedWinner,
    loserId: resolvedLoser
  });
};

describe("Bracket engines", () => {
  it("builds the expected single elimination shape for 4 entrants", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(4),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(4);
    expect(snapshot.rounds.filter((round) => round.side === "WINNERS")).toHaveLength(2);
    expect(findMatch(snapshot, "WINNERS", 1, 1).status).toBe("READY");
    expect(findMatch(snapshot, "WINNERS", 1, 2).status).toBe("READY");
    expect(findMatch(snapshot, "WINNERS", 2, 1).status).toBe("PENDING");
  });

  it("builds the expected single elimination shape for 8 entrants", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(8),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(8);
    expect(snapshot.rounds.filter((round) => round.side === "WINNERS")).toHaveLength(3);
    expect(snapshot.rounds.filter((round) => round.side === "WINNERS")[0]?.matchIds).toHaveLength(4);
    expect(snapshot.rounds.filter((round) => round.side === "WINNERS")[1]?.matchIds).toHaveLength(2);
    expect(snapshot.rounds.filter((round) => round.side === "WINNERS")[2]?.matchIds).toHaveLength(1);
  });

  it("pads odd participant counts with byes and auto-advances the affected entrant", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(5),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(8);
    const openingMatches = snapshot.rounds
      .filter((round) => round.side === "WINNERS" && round.roundNumber === 1)[0]!
      .matchIds.map((matchId) => snapshot.matches[matchId]!);

    const autoCompleted = openingMatches.filter((match) => match.status === "COMPLETED");
    expect(autoCompleted.length).toBeGreaterThan(0);
    expect(autoCompleted.every((match) => match.winnerId !== null)).toBe(true);

    const secondRoundReady = snapshot.rounds
      .filter((round) => round.side === "WINNERS" && round.roundNumber === 2)[0]!
      .matchIds.map((matchId) => snapshot.matches[matchId]!)
      .some((match) => match.slots.some((slot) => slot.entrantId !== null));

    expect(secondRoundReady).toBe(true);
  });

  it("advances a 4-player single elimination bracket to a champion", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    let snapshot = engine.generate({
      entrants: entrants(4),
      bestOf: 3
    });

    snapshot = playMatch(engine, snapshot, "WINNERS", 1, 1, "p1").snapshot;
    snapshot = playMatch(engine, snapshot, "WINNERS", 1, 2, "p2").snapshot;

    const finalMatch = findMatch(snapshot, "WINNERS", 2, 1);
    expect(finalMatch.status).toBe("READY");
    expect(finalMatch.slots.map((slot) => slot.entrantId)).toEqual(["p1", "p2"]);

    const finalResult = playMatch(engine, snapshot, "WINNERS", 2, 1, "p1");
    expect(finalResult.finalized).toBe(true);
    expect(finalResult.championId).toBe("p1");

    const placements = engine.calculatePlacements(finalResult.snapshot);
    expect(placements[0]).toEqual({
      placement: 1,
      entrantIds: ["p1"],
      reason: "Champion"
    });
  });

  it("routes losers from winners bracket into losers bracket in double elimination", () => {
    const engine = BracketEngineFactory.create("DOUBLE_ELIMINATION");
    const initial = engine.generate({
      entrants: entrants(4),
      bestOf: 3,
      grandFinalResetEnabled: true
    });

    const afterLoss = playMatch(engine, initial, "WINNERS", 1, 1, "p1").snapshot;
    const losersRoundOne = findMatch(afterLoss, "LOSERS", 1, 1);

    expect(losersRoundOne.slots.map((slot) => slot.entrantId)).toContain("p4");
    expect(losersRoundOne.slots.some((slot) => slot.sourceOutcome === "LOSER")).toBe(true);
  });

  it("progresses through double elimination finals without a reset when winners side wins grand finals", () => {
    const engine = BracketEngineFactory.create("DOUBLE_ELIMINATION");
    let snapshot = engine.generate({
      entrants: entrants(4),
      bestOf: 3,
      grandFinalResetEnabled: true
    });

    snapshot = playMatch(engine, snapshot, "WINNERS", 1, 1, "p1").snapshot;
    snapshot = playMatch(engine, snapshot, "WINNERS", 1, 2, "p2").snapshot;
    snapshot = playMatch(engine, snapshot, "LOSERS", 1, 1, "p3").snapshot;
    snapshot = playMatch(engine, snapshot, "WINNERS", 2, 1, "p1").snapshot;
    snapshot = playMatch(engine, snapshot, "LOSERS", 2, 1, "p2").snapshot;

    const grandFinal = findMatch(snapshot, "GRAND_FINALS", 1, 1);
    expect(grandFinal.status).toBe("READY");
    expect(grandFinal.slots.map((slot) => slot.entrantId).sort()).toEqual(["p1", "p2"]);

    const grandFinalResult = playMatch(engine, snapshot, "GRAND_FINALS", 1, 1, "p1");
    expect(grandFinalResult.finalized).toBe(true);
    expect(grandFinalResult.championId).toBe("p1");

    const resetMatch = findMatch(grandFinalResult.snapshot, "GRAND_FINALS", 2, 1);
    expect(resetMatch.status).toBe("PENDING");
    expect(resetMatch.slots.map((slot) => slot.entrantId)).toEqual([null, null]);
  });

  it("creates and resolves a grand finals reset when the losers-side finalist wins the first set", () => {
    const engine = BracketEngineFactory.create("DOUBLE_ELIMINATION");
    let snapshot = engine.generate({
      entrants: entrants(4),
      bestOf: 3,
      grandFinalResetEnabled: true
    });

    snapshot = playMatch(engine, snapshot, "WINNERS", 1, 1, "p1").snapshot;
    snapshot = playMatch(engine, snapshot, "WINNERS", 1, 2, "p2").snapshot;
    snapshot = playMatch(engine, snapshot, "LOSERS", 1, 1, "p3").snapshot;
    snapshot = playMatch(engine, snapshot, "WINNERS", 2, 1, "p1").snapshot;
    snapshot = playMatch(engine, snapshot, "LOSERS", 2, 1, "p2").snapshot;

    const firstGrandFinal = playMatch(engine, snapshot, "GRAND_FINALS", 1, 1, "p2");
    expect(firstGrandFinal.finalized).toBe(false);
    expect(firstGrandFinal.championId).toBeNull();

    const resetMatch = findMatch(firstGrandFinal.snapshot, "GRAND_FINALS", 2, 1);
    expect(resetMatch.status).toBe("READY");
    expect(resetMatch.slots.map((slot) => slot.entrantId).sort()).toEqual(["p1", "p2"]);

    const resetResult = playMatch(engine, firstGrandFinal.snapshot, "GRAND_FINALS", 2, 1, "p2");
    expect(resetResult.finalized).toBe(true);
    expect(resetResult.championId).toBe("p2");
  });

  it("rejects duplicate advancement of the same match", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(4),
      bestOf: 3
    });

    const advanced = playMatch(engine, snapshot, "WINNERS", 1, 1, "p1").snapshot;
    const sameMatch = findMatch(advanced, "WINNERS", 1, 1);

    expect(() =>
      engine.advance(advanced, {
        matchId: sameMatch.id,
        winnerId: "p1",
        loserId: "p4"
      })
    ).toThrow(DomainConflictError);
  });

  it("rejects invalid match results when the reported entrants do not match the node", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(4),
      bestOf: 3
    });

    const match = findMatch(snapshot, "WINNERS", 1, 1);

    expect(() =>
      engine.advance(snapshot, {
        matchId: match.id,
        winnerId: "p999",
        loserId: "p1"
      })
    ).toThrow(DomainValidationError);
  });
});
