import { describe, expect, it } from "vitest";

import { buildBracketLayout } from "../src/renderers/bracket-layout.js";
import type { BracketRenderRound } from "../src/renderers/types.js";

const constants = {
  cardWidth: 280,
  cardHeight: 104,
  columnGap: 88,
  rowGap: 28,
  leftPad: 48,
  topPad: 32,
  rightPad: 48,
  bottomPad: 40,
  headerHeight: 116,
  pageInfoHeight: 42
};

const makeRound = (
  roundNumber: number,
  count: number,
  nextIds?: string[]
): BracketRenderRound => ({
  id: `r${roundNumber}`,
  side: "WINNERS",
  roundNumber,
  name: `Round ${roundNumber}`,
  matches: Array.from({ length: count }, (_, index) => ({
    id: `m${roundNumber}-${index + 1}`,
    side: "WINNERS",
    roundNumber,
    sequence: index + 1,
    status: "READY",
    player1Name: `P${index * 2 + 1}`,
    player2Name: `P${index * 2 + 2}`,
    winnerName: null,
    scoreLabel: null,
    nextMatchId: nextIds?.[index] ?? null,
    originEntrantIds: [`e${index * 2 + 1}`, `e${index * 2 + 2}`],
    displayEntrantIds: [`e${index * 2 + 1}`, `e${index * 2 + 2}`]
  }))
});

describe("buildBracketLayout", () => {
  it("packs small brackets without full-tree gaps", () => {
    const rounds = [
      makeRound(1, 2, ["m2-1", "m2-1"]),
      makeRound(2, 1)
    ];

    const layout = buildBracketLayout(rounds, constants);

    expect(layout.rounds[0]!.matches).toHaveLength(2);
    expect(layout.rounds[1]!.matches).toHaveLength(1);
    expect(layout.height).toBeLessThan(520);
    expect(layout.rounds[1]!.matches[0]!.centerY).toBeGreaterThan(layout.rounds[0]!.matches[0]!.centerY);
    expect(layout.rounds[1]!.matches[0]!.centerY).toBeLessThan(layout.rounds[0]!.matches[1]!.centerY);
  });

  it("keeps sparse later rounds on the same structured grid", () => {
    const rounds = [
      makeRound(
        1,
        9,
        ["m2-1", "m2-1", "m2-2", "m2-2", "m2-3", "m2-3", "m2-4", "m2-4", "m2-5"]
      ),
      makeRound(2, 5, ["m3-1", "m3-1", "m3-2", "m3-2", "m3-3"]),
      makeRound(3, 3, ["m4-1", "m4-1", "m4-2"]),
      makeRound(4, 2, ["m5-1", "m5-1"]),
      makeRound(5, 1)
    ];

    const layout = buildBracketLayout(rounds, constants, { useStructuredGrid: true });

    expect(layout.rounds[1]!.matches[4]!.centerY).toBeGreaterThan(layout.rounds[1]!.matches[3]!.centerY);
    expect(layout.rounds[2]!.matches[2]!.centerY).toBeGreaterThan(layout.rounds[2]!.matches[1]!.centerY);
    expect(layout.rounds[3]!.matches[1]!.centerY).toBeGreaterThan(layout.rounds[3]!.matches[0]!.centerY);
    expect(layout.rounds[4]!.matches[0]!.centerY).toBeGreaterThan(layout.rounds[3]!.matches[0]!.centerY);
  });

  it("anchors play-ins against the widest main bracket round instead of cascading downward", () => {
    const rounds = [
      makeRound(1, 3, ["m2-1", "m2-2", "m2-2"]),
      makeRound(
        2,
        4,
        ["m3-1", "m3-1", "m3-2", "m3-2"]
      ),
      makeRound(3, 2, ["m4-1", "m4-1"]),
      makeRound(4, 1)
    ];

    const layout = buildBracketLayout(rounds, constants, { useStructuredGrid: true });

    expect(layout.rounds[1]!.matches).toHaveLength(4);
    expect(layout.rounds[0]!.matches[0]!.centerY).toBe(layout.rounds[1]!.matches[0]!.centerY);
    expect(layout.rounds[0]!.matches[1]!.centerY).toBeLessThan(layout.rounds[1]!.matches[1]!.centerY);
    expect(layout.rounds[0]!.matches[2]!.centerY).toBeGreaterThan(layout.rounds[1]!.matches[1]!.centerY);
  });

  it("keeps same input deterministic", () => {
    const rounds = [
      makeRound(1, 4, ["m2-1", "m2-1", "m2-2", "m2-2"]),
      makeRound(2, 2, ["m3-1", "m3-1"]),
      makeRound(3, 1)
    ];

    const first = buildBracketLayout(rounds, constants);
    const second = buildBracketLayout(rounds, constants);

    expect(second).toEqual(first);
  });

  it("never overlaps match cards inside a round", () => {
    const rounds = [
      makeRound(1, 8, Array.from({ length: 8 }, (_, index) => `m2-${Math.floor(index / 2) + 1}`)),
      makeRound(2, 4)
    ];

    const layout = buildBracketLayout(rounds, constants);
    const firstRoundMatches = layout.rounds[0]!.matches;

    for (let index = 1; index < firstRoundMatches.length; index += 1) {
      expect(firstRoundMatches[index]!.y).toBeGreaterThanOrEqual(
        firstRoundMatches[index - 1]!.y + constants.cardHeight + constants.rowGap
      );
    }
  });
});
