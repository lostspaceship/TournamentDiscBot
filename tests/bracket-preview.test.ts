import { MatchStatus, TournamentFormat, TournamentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { BracketEngineFactory } from "../src/domain/bracket/engine.js";
import {
  buildPersistedSnapshotFromTournament,
  resolveTournamentBracketSnapshot
} from "../src/services/support/bracket-snapshot.js";

const buildTournament = (entrantCount: number) => ({
  id: "t1",
  guildId: "g1",
  name: "Preview Cup",
  status: TournamentStatus.REGISTRATION_OPEN,
  format: TournamentFormat.SINGLE_ELIMINATION,
  bestOfDefault: 3,
  requireCheckIn: false,
  settings: {
    seedingMethod: "RANDOM",
    grandFinalResetEnabled: true
  },
  registrations: Array.from({ length: entrantCount }, (_, index) => ({
    id: `r${index + 1}`,
    participantId: `p${index + 1}`,
    joinedAt: new Date(`2026-04-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
    status: "ACTIVE",
    seed: null,
    checkIn: null,
    participant: {
      displayName: `Player ${index + 1}`,
      rating: null
    }
  })),
  brackets: [],
  waitlistEntries: [],
  auditLogs: []
});

describe("resolveTournamentBracketSnapshot", () => {
  it("creates a live preview snapshot while registration remains open", () => {
    const result = resolveTournamentBracketSnapshot(buildTournament(5) as never);

    expect(result.mode).toBe("PREVIEW");
    expect(result.snapshot?.metadata.bracketSize).toBe(8);

    const firstRoundMatches = result.snapshot?.rounds
      .filter((round) => round.side === "WINNERS" && round.roundNumber === 1)[0]
      ?.matchIds.map((matchId) => result.snapshot?.matches[matchId]);

    expect(firstRoundMatches?.some((match) => match?.status === "COMPLETED")).toBe(true);
  });

  it("returns no preview when fewer than two eligible entrants exist", () => {
    const result = resolveTournamentBracketSnapshot(buildTournament(1) as never);

    expect(result.mode).toBe("NONE");
    expect(result.snapshot).toBeNull();
  });

  it("does not treat unresolved future slots as byes after the bracket is persisted", () => {
    const tournament = {
      ...buildTournament(4),
      status: TournamentStatus.IN_PROGRESS,
      brackets: [
        {
          type: "WINNERS",
          rounds: [
            {
              id: "round-1",
              roundNumber: 1,
              matches: [
                {
                  id: "t1:winners-r1-m1",
                  bracketType: "WINNERS",
                  sequence: 1,
                  bestOf: 3,
                  status: MatchStatus.READY,
                  player1RegistrationId: "r1",
                  player2RegistrationId: "r2",
                  winnerRegistrationId: null,
                  loserRegistrationId: null,
                  nextMatchId: "t1:winners-r2-m1",
                  nextMatchSlot: 0,
                  loserNextMatchId: null,
                  loserNextMatchSlot: null,
                  resetOfMatchId: null
                },
                {
                  id: "t1:winners-r1-m2",
                  bracketType: "WINNERS",
                  sequence: 2,
                  bestOf: 3,
                  status: MatchStatus.READY,
                  player1RegistrationId: "r3",
                  player2RegistrationId: "r4",
                  winnerRegistrationId: null,
                  loserRegistrationId: null,
                  nextMatchId: "t1:winners-r2-m1",
                  nextMatchSlot: 1,
                  loserNextMatchId: null,
                  loserNextMatchSlot: null,
                  resetOfMatchId: null
                }
              ]
            },
            {
              id: "round-2",
              roundNumber: 2,
              matches: [
                {
                  id: "t1:winners-r2-m1",
                  bracketType: "WINNERS",
                  sequence: 1,
                  bestOf: 3,
                  status: MatchStatus.PENDING,
                  player1RegistrationId: null,
                  player2RegistrationId: null,
                  winnerRegistrationId: null,
                  loserRegistrationId: null,
                  nextMatchId: null,
                  nextMatchSlot: null,
                  loserNextMatchId: null,
                  loserNextMatchSlot: null,
                  resetOfMatchId: null
                }
              ]
            }
          ]
        }
      ]
    };

    const snapshot = buildPersistedSnapshotFromTournament(tournament as never);
    const engine = BracketEngineFactory.create("SINGLE_ELIMINATION");
    const afterAdvance = engine.advance(snapshot, {
      matchId: "t1:winners-r1-m1",
      winnerId: "r1",
      loserId: "r2"
    });

    expect(afterAdvance.finalized).toBe(false);
    expect(afterAdvance.championId).toBeNull();
    expect(afterAdvance.snapshot.matches["t1:winners-r2-m1"]?.status).toBe("PENDING");
    expect(afterAdvance.snapshot.matches["t1:winners-r2-m1"]?.winnerId).toBeNull();
    expect(afterAdvance.snapshot.matches["t1:winners-r2-m1"]?.slots[0].entrantId).toBe("r1");
    expect(afterAdvance.snapshot.matches["t1:winners-r2-m1"]?.slots[1].entrantId).toBeNull();
  });
});
