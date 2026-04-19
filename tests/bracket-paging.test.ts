import { describe, expect, it } from "vitest";

import {
  buildBracketTabs,
  MAX_MATCHES_PER_PAGE,
  MAX_PARTICIPANTS_PER_PAGE,
  type BracketPagingRound
} from "../src/renderers/bracket-paging.js";

const makeRound = (
  side: "WINNERS" | "LOSERS" | "GRAND_FINALS",
  roundNumber: number,
  matchCount: number,
  entrantOffset = 0
): BracketPagingRound => ({
  id: `${side}-${roundNumber}`,
  side,
  roundNumber,
  name: `${side} Round ${roundNumber}`,
  matches: Array.from({ length: matchCount }, (_, index) => {
    const entrantBase = entrantOffset + index * 2 + 1;
    return {
      id: `${side}-${roundNumber}-${index + 1}`,
      side,
      roundNumber,
      sequence: index + 1,
      status: "READY",
      player1Name: `P${entrantBase}`,
      player2Name: `P${entrantBase + 1}`,
      winnerName: null,
      scoreLabel: null,
      nextMatchId: null,
      originEntrantIds: [`r${entrantBase}`, `r${entrantBase + 1}`],
      displayEntrantIds: [`r${entrantBase}`, `r${entrantBase + 1}`]
    };
  })
});

describe("buildBracketTabs", () => {
  it("keeps up to 16 entrants on a single winners page", () => {
    const rounds = [makeRound("WINNERS", 1, 8)];
    const entrantOrder = Array.from({ length: 16 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "PREVIEW",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 16
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
    expect(winners?.pages[0]?.entrantIds.length).toBeLessThanOrEqual(MAX_PARTICIPANTS_PER_PAGE);
  });

  it("keeps winners on one page even once more than 16 entrants are represented", () => {
    const rounds = [makeRound("WINNERS", 1, 12)];
    const entrantOrder = Array.from({ length: 24 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "PREVIEW",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 24
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
    expect(winners?.pages[0]?.rounds[0]?.matches).toHaveLength(12);
  });

  it("keeps official winners rounds together on one page", () => {
    const rounds: BracketPagingRound[] = [
      makeRound("WINNERS", 1, 12),
      {
        id: "WINNERS-2",
        side: "WINNERS",
        roundNumber: 2,
        name: "Winners Round 2",
        matches: [
          {
            id: "WINNERS-2-1",
            side: "WINNERS",
            roundNumber: 2,
            sequence: 1,
            status: "READY",
            player1Name: "P1",
            player2Name: "P18",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r1", "r18"],
            displayEntrantIds: ["r1", "r18"]
          }
        ]
      }
    ];
    const entrantOrder = Array.from({ length: 24 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "OFFICIAL",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 24
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
    expect(
      winners?.pages[0]?.rounds.some((round) =>
        round.matches.some((match) => match.id === "WINNERS-2-1")
      )
    ).toBe(true);
  });

  it("re-packs sparse adjacent pages back down when they fit within 16 entrants", () => {
    const rounds: BracketPagingRound[] = [
      {
        id: "WINNERS-1",
        side: "WINNERS",
        roundNumber: 1,
        name: "Winners Round 1",
        matches: [
          {
            id: "WINNERS-1-1",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 1,
            status: "READY",
            player1Name: "P1",
            player2Name: "P2",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r1", "r2"],
            displayEntrantIds: ["r1", "r2"]
          },
          {
            id: "WINNERS-1-2",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 2,
            status: "READY",
            player1Name: "P3",
            player2Name: "P4",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r3", "r4"],
            displayEntrantIds: ["r3", "r4"]
          },
          {
            id: "WINNERS-1-3",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 3,
            status: "READY",
            player1Name: "P19",
            player2Name: "P20",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r17", "r18"],
            displayEntrantIds: ["r17", "r18"]
          },
          {
            id: "WINNERS-1-4",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 4,
            status: "READY",
            player1Name: "P21",
            player2Name: "P22",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r19", "r20"],
            displayEntrantIds: ["r19", "r20"]
          }
        ]
      }
    ];
    const entrantOrder = Array.from({ length: 20 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "OFFICIAL",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 20
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
    expect(winners?.pages[0]?.entrantIds.length).toBeLessThanOrEqual(MAX_PARTICIPANTS_PER_PAGE);
  });

  it("keeps a single winners page title after flattening", () => {
    const rounds = [makeRound("WINNERS", 1, 10)];
    const entrantOrder = Array.from({ length: 20 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "OFFICIAL",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 20
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
    expect(winners?.pages[0]?.title).toBe("Brackets");
  });

  it("merges pages based on visible entrants when sparse later-state content fits back onto one page", () => {
    const rounds: BracketPagingRound[] = [
      {
        id: "WINNERS-2",
        side: "WINNERS",
        roundNumber: 2,
        name: "Winners Round 2",
        matches: [
          {
            id: "WINNERS-2-1",
            side: "WINNERS",
            roundNumber: 2,
            sequence: 1,
            status: "READY",
            player1Name: "P1",
            player2Name: "P2",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r1", "r2", "r3", "r4"],
            displayEntrantIds: ["r1", "r2"]
          },
          {
            id: "WINNERS-2-2",
            side: "WINNERS",
            roundNumber: 2,
            sequence: 2,
            status: "READY",
            player1Name: "P17",
            player2Name: "P18",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r17", "r18", "r19", "r20"],
            displayEntrantIds: ["r17", "r18"]
          }
        ]
      }
    ];
    const entrantOrder = Array.from({ length: 20 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "OFFICIAL",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 20
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
  });

  it("splits a side page when more than 8 match cards would be shown on one image", () => {
    const rounds = [makeRound("LOSERS", 1, 9)];
    const entrantOrder = Array.from({ length: 18 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "OFFICIAL",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 18
    });

    const losers = tabs.find((entry) => entry.key === "LOSERS");
    expect(losers?.pages.length).toBeGreaterThan(1);
    expect(
      losers?.pages.every((page) => (page.rounds[0]?.matches.length ?? 0) <= MAX_MATCHES_PER_PAGE)
    ).toBe(true);
  });

  it("keeps preview winners on one page even with downstream rounds", () => {
    const rounds: BracketPagingRound[] = [
      makeRound("WINNERS", 1, 12),
      {
        id: "WINNERS-2",
        side: "WINNERS",
        roundNumber: 2,
        name: "Winners Round 2",
        matches: Array.from({ length: 6 }, (_, index) => ({
          id: `WINNERS-2-${index + 1}`,
          side: "WINNERS",
          roundNumber: 2,
          sequence: index + 1,
          status: "PENDING",
          player1Name: "",
          player2Name: "",
          winnerName: null,
          scoreLabel: null,
          nextMatchId: null,
          originEntrantIds: [`r${index * 4 + 1}`, `r${index * 4 + 2}`, `r${index * 4 + 3}`, `r${index * 4 + 4}`],
          displayEntrantIds: []
        }))
      }
    ];
    const entrantOrder = Array.from({ length: 24 }, (_, index) => `r${index + 1}`);

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "PREVIEW",
      rounds,
      placements: [],
      entrantOrder,
      registrationCount: 24
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
    expect(winners?.pages[0]?.rounds.length).toBeGreaterThan(1);
  });

  it("keeps preview on a single expanding page instead of splitting for odd entrant overflow", () => {
    const rounds: BracketPagingRound[] = [
      {
        id: "WINNERS-1",
        side: "WINNERS",
        roundNumber: 1,
        name: "Winners Round 1",
        matches: [
          ...Array.from({ length: 8 }, (_, index) => ({
            id: `WINNERS-1-full-${index + 1}`,
            side: "WINNERS" as const,
            roundNumber: 1,
            sequence: index + 1,
            status: "READY",
            player1Name: `P${index * 2 + 1}`,
            player2Name: `P${index * 2 + 2}`,
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: [`r${index * 2 + 1}`, `r${index * 2 + 2}`],
            displayEntrantIds: [`r${index * 2 + 1}`, `r${index * 2 + 2}`]
          })),
          {
            id: "WINNERS-1-bye",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 9,
            status: "PENDING",
            player1Name: "P17",
            player2Name: "",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r17"],
            displayEntrantIds: ["r17"]
          }
        ]
      }
    ];

    const tabs = buildBracketTabs({
      snapshot: null,
      mode: "PREVIEW",
      rounds,
      placements: [],
      entrantOrder: Array.from({ length: 17 }, (_, index) => `r${index + 1}`),
      registrationCount: 17
    });

    const winners = tabs.find((entry) => entry.key === "WINNERS");
    expect(winners?.pages).toHaveLength(1);
    expect(winners?.pages[0]?.rounds[0]?.matches).toHaveLength(9);
  });
});
