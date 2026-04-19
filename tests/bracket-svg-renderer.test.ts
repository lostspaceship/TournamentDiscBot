import { describe, expect, it } from "vitest";

import { BracketSvgRenderer } from "../src/renderers/bracket-svg-renderer.js";
import type { BracketRenderModel } from "../src/renderers/types.js";

const makeModel = (): BracketRenderModel => ({
  tournamentId: "t1",
  tournamentName: "V2 1v1 Viewer Tournament",
  status: "IN_PROGRESS",
  mode: "PREVIEW",
  updatedLabel: "Updated now",
  registrationCount: 8,
  activeTab: "WINNERS",
  activeTabLabel: "Winners",
  page: 1,
  totalPages: 1,
  tabs: [{ key: "WINNERS", label: "Winners", pageCount: 1 }],
  pageModel: {
    title: "Winners",
    subtitle: "Unused",
    entrantIds: ["r1", "r2"],
    rounds: [
      {
        id: "round-1",
        side: "WINNERS",
        roundNumber: 1,
        name: "Winners Round 1",
        matches: [
          {
            id: "m1",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 1,
            status: "READY",
            player1Name: "Alpha",
            player2Name: "Bravo",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: "m2",
            originEntrantIds: ["r1", "r2"],
            displayEntrantIds: ["r1", "r2"]
          }
        ]
      },
      {
        id: "round-2",
        side: "WINNERS",
        roundNumber: 2,
        name: "Winners Round 2",
        matches: [
          {
            id: "m2",
            side: "WINNERS",
            roundNumber: 2,
            sequence: 1,
            status: "PENDING",
            player1Name: "",
            player2Name: "",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r1", "r2"],
            displayEntrantIds: []
          }
        ]
      }
    ]
  }
});

describe("BracketSvgRenderer", () => {
  it("renders structural placeholder cards without noisy helper copy", () => {
    const svg = new BracketSvgRenderer().render(makeModel());

    expect(svg).toContain("MATCH 1");
    expect(svg).toContain("Pending");
    expect(svg).not.toContain("Advances Here");
    expect(svg).not.toContain("Waiting on prior match");
    expect(svg).not.toContain("Unused");
  });

  it("renders overflow-style page data as a real bracket subtree with multiple rounds and connectors", () => {
    const model = makeModel();
    model.page = 2;
    model.totalPages = 2;
    model.pageModel.rounds = [
      {
        id: "round-1",
        side: "WINNERS",
        roundNumber: 1,
        name: "Winners Round 1",
        matches: [
          {
            id: "m1",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 5,
            status: "READY",
            player1Name: "Player 9",
            player2Name: "Player 10",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: "m3",
            originEntrantIds: ["r9", "r10"],
            displayEntrantIds: ["r9", "r10"]
          },
          {
            id: "m2",
            side: "WINNERS",
            roundNumber: 1,
            sequence: 6,
            status: "READY",
            player1Name: "Player 11",
            player2Name: "Player 12",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: "m3",
            originEntrantIds: ["r11", "r12"],
            displayEntrantIds: ["r11", "r12"]
          }
        ]
      },
      {
        id: "round-2",
        side: "WINNERS",
        roundNumber: 2,
        name: "Winners Round 2",
        matches: [
          {
            id: "m3",
            side: "WINNERS",
            roundNumber: 2,
            sequence: 3,
            status: "PENDING",
            player1Name: "",
            player2Name: "",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: "m4",
            originEntrantIds: ["r9", "r10", "r11", "r12"],
            displayEntrantIds: []
          }
        ]
      },
      {
        id: "round-3",
        side: "WINNERS",
        roundNumber: 3,
        name: "Winners Round 3",
        matches: [
          {
            id: "m4",
            side: "WINNERS",
            roundNumber: 3,
            sequence: 2,
            status: "PENDING",
            player1Name: "",
            player2Name: "",
            winnerName: null,
            scoreLabel: null,
            nextMatchId: null,
            originEntrantIds: ["r9", "r10", "r11", "r12"],
            displayEntrantIds: []
          }
        ]
      }
    ];

    const svg = new BracketSvgRenderer().render(model);

    expect(svg).not.toContain("WINNERS ROUND 1");
    expect(svg).not.toContain("WINNERS ROUND 2");
    expect(svg).not.toContain("WINNERS ROUND 3");
    expect((svg.match(/<path d=\"M /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(svg).toContain("MATCH 5");
    expect(svg).toContain("MATCH 6");
    expect(svg).toContain("MATCH 3");
    expect(svg).toContain("MATCH 2");
  });
});
