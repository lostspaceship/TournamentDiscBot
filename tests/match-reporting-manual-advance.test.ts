import { MatchStatus, TournamentFormat, TournamentStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn()
  }
}));

vi.mock("../src/config/prisma.js", () => ({
  prisma: prismaMock
}));

import { MatchReportingService } from "../src/services/match-reporting-service.js";

describe("MatchReportingService.manualAdvance", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
  });

  it("rejects manual advancement when the selected winner is not assigned to the match", async () => {
    const tx = {
      $queryRaw: vi.fn(),
      tournament: {
        findUnique: vi.fn().mockResolvedValue({
          id: "t1",
          guildId: "g1",
          status: TournamentStatus.IN_PROGRESS,
          format: TournamentFormat.SINGLE_ELIMINATION,
          settings: {
            grandFinalResetEnabled: true
          },
          registrations: [
            {
              id: "r1",
              participantId: "p1",
              status: "ACTIVE",
              participant: { discordUserId: "u1" }
            },
            {
              id: "r2",
              participantId: "p2",
              status: "ACTIVE",
              participant: { discordUserId: "u2" }
            }
          ],
          resultReports: [],
          brackets: [
            {
              rounds: [
                {
                  matches: [
                    {
                      id: "m1",
                      player1RegistrationId: "r1",
                      player2RegistrationId: "r2",
                      status: MatchStatus.READY,
                      version: 1,
                      reports: []
                    }
                  ]
                }
              ]
            }
          ],
          waitlistEntries: [],
          auditLogs: []
        })
      }
    };

    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));

    const service = new MatchReportingService({} as never);

    await expect(
      service.manualAdvance({
        guildId: "g1",
        tournamentId: "t1",
        actorUserId: "mod-1",
        matchId: "m1",
        winnerRegistrationId: "r999",
        reason: "No show",
        idempotencyKey: "interaction-1"
      })
    ).rejects.toThrowError(/not assigned to this match/i);
  });
});
