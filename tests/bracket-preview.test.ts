import { TournamentFormat, TournamentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resolveTournamentBracketSnapshot } from "../src/services/support/bracket-snapshot.js";

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
});
