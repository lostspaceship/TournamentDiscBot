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

    expect(snapshot.metadata.bracketSize).toBe(4);
    const openingMatches = snapshot.rounds
      .filter((round) => round.side === "WINNERS" && round.roundNumber === 1)[0]!
      .matchIds.map((matchId) => snapshot.matches[matchId]!);

    expect(openingMatches).toHaveLength(1);
    expect(openingMatches[0]?.status).toBe("READY");

    const mainRound = snapshot.rounds
      .filter((round) => round.side === "WINNERS" && round.roundNumber === 2)[0]!
      .matchIds.map((matchId) => snapshot.matches[matchId]!);

    expect(mainRound).toHaveLength(2);
    expect(mainRound.some((match) => match.slots.some((slot) => slot.sourceMatchId != null))).toBe(true);
  });

  it("keeps exact power-of-two fields as a clean main bracket for 32 entrants", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(32),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(32);
    expect(snapshot.rounds.filter((round) => round.side === "WINNERS")).toHaveLength(5);
    expect(snapshot.rounds[0]?.matchIds).toHaveLength(16);
  });

  it("keeps exact power-of-two fields as a clean main bracket for 64 entrants", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(64),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(64);
    expect(snapshot.rounds.filter((round) => round.side === "WINNERS")).toHaveLength(6);
    expect(snapshot.rounds[0]?.matchIds).toHaveLength(32);
  });

  it("creates one play-in match for 33 entrants and maps it into the 32 bracket", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(33),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(32);
    const rounds = snapshot.rounds.filter((round) => round.side === "WINNERS");
    expect(rounds).toHaveLength(6);
    expect(rounds[0]?.matchIds).toHaveLength(1);
    expect(rounds[1]?.matchIds).toHaveLength(16);

    const playInMatch = snapshot.matches[rounds[0]!.matchIds[0]!]!;
    expect(playInMatch.slots.map((slot) => slot.entrantId)).toEqual(["p32", "p33"]);
    expect(playInMatch.nextMatchId).toBeTruthy();
  });

  it("creates four play-in matches for 36 entrants and leaves 28 direct entries in the main 32 bracket", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(36),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(32);
    const rounds = snapshot.rounds.filter((round) => round.side === "WINNERS");
    expect(rounds[0]?.matchIds).toHaveLength(4);
    expect(rounds[1]?.matchIds).toHaveLength(16);

    const playInMatches = rounds[0]!.matchIds.map((matchId) => snapshot.matches[matchId]!);
    expect(playInMatches.map((match) => match.slots.map((slot) => slot.entrantId))).toEqual([
      ["p32", "p33"],
      ["p29", "p36"],
      ["p31", "p34"],
      ["p30", "p35"]
    ]);
  });

  it("creates twelve play-in matches for 44 entrants and twenty direct entries into the main 32 bracket", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(44),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(32);
    const rounds = snapshot.rounds.filter((round) => round.side === "WINNERS");
    expect(rounds[0]?.matchIds).toHaveLength(12);
    expect(rounds[1]?.matchIds).toHaveLength(16);

    const playInMatches = rounds[0]!.matchIds.map((matchId) => snapshot.matches[matchId]!);
    expect(playInMatches[0]?.slots.map((slot) => slot.entrantId)).toEqual(["p32", "p33"]);
    expect(playInMatches[1]?.slots.map((slot) => slot.entrantId)).toEqual(["p25", "p40"]);
    expect(playInMatches.at(-1)?.slots.map((slot) => slot.entrantId)).toEqual(["p22", "p43"]);

    const directEntrantsInMainRound = rounds[1]!.matchIds
      .map((matchId) => snapshot.matches[matchId]!)
      .flatMap((match) =>
        match.slots
          .filter((slot) => slot.sourceMatchId == null)
          .map((slot) => slot.entrantId)
      )
      .filter((entrantId): entrantId is string => entrantId != null);

    expect(new Set(directEntrantsInMainRound).size).toBe(20);
  });

  it("creates sixteen play-in matches for 48 entrants and maps them into the main 32 bracket", () => {
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const snapshot = engine.generate({
      entrants: entrants(48),
      bestOf: 3
    });

    expect(snapshot.metadata.bracketSize).toBe(32);
    const rounds = snapshot.rounds.filter((round) => round.side === "WINNERS");
    expect(rounds[0]?.matchIds).toHaveLength(16);
    expect(rounds[1]?.matchIds).toHaveLength(16);

    const firstMainRound = rounds[1]!.matchIds.map((matchId) => snapshot.matches[matchId]!);
    expect(firstMainRound.every((match) => match.slots.some((slot) => slot.sourceMatchId != null))).toBe(true);
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
