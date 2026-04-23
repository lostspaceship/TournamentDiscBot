import {
  AuditAction,
  MatchStatus,
  RegistrationStatus,
  TournamentFormat,
  TournamentStatus
} from "@prisma/client";
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

  it("marks a self-leave after start as withdrawn so rejoin is no longer blocked", async () => {
    const registrationUpdate = vi.fn().mockResolvedValue(undefined);
    const auditCreate = vi.fn().mockResolvedValue(undefined);
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
              status: RegistrationStatus.ACTIVE,
              participant: { discordUserId: "u1", displayName: "Player One" }
            },
            {
              id: "r2",
              participantId: "p2",
              status: RegistrationStatus.ACTIVE,
              participant: { discordUserId: "u2", displayName: "Player Two" }
            }
          ],
          resultReports: [],
          brackets: [
            {
              rounds: [
                {
                  roundNumber: 1,
                  matches: [
                    {
                      id: "m1",
                      sequence: 1,
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
      },
      registration: {
        update: registrationUpdate
      },
      auditLog: {
        create: auditCreate
      }
    };

    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));

    const service = new MatchReportingService({} as never);
    vi.spyOn(service as never, "applyManualAdvanceTx").mockResolvedValue({
      reportId: "report-1"
    } as never);

    await service.kickParticipantBySelection({
      guildId: "g1",
      tournamentId: "t1",
      actorUserId: "u1",
      targetUserId: "u1"
    });

    expect(registrationUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({
        status: RegistrationStatus.WITHDRAWN,
        placement: null
      })
    });
  });

  it("allows undoing the latest manual advance when only automatic follow-up audits exist", async () => {
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
          registrations: [],
          resultReports: [],
          brackets: [],
          waitlistEntries: [],
          auditLogs: []
        })
      },
      auditLog: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "audit-1",
            targetId: "report-1",
            createdAt: new Date("2026-04-19T10:00:00.000Z")
          })
          .mockResolvedValueOnce(null)
      }
    };

    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));

    const service = new MatchReportingService({} as never);
    const undoSpy = vi
      .spyOn(service, "undoManualAdvance")
      .mockResolvedValue(undefined as never);

    const result = await service.undoLatestManualAdvance({
      guildId: "g1",
      tournamentId: "t1",
      actorUserId: "mod-1"
    });

    expect(tx.auditLog.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          action: {
            in: [
              AuditAction.RESULT_CONFIRMED,
              AuditAction.RESULT_OVERRIDDEN,
              AuditAction.MANUAL_ADVANCE,
              AuditAction.MANUAL_ADVANCE_UNDONE
            ]
          }
        })
      })
    );
    expect(undoSpy).toHaveBeenCalledWith({
      guildId: "g1",
      tournamentId: "t1",
      actorUserId: "mod-1",
      reportId: "report-1"
    });
    expect(result).toEqual({ reportId: "report-1" });
  });

  it("moves a player back one match when their current slot came from a manual advance", async () => {
    const matchUpdate = vi.fn().mockResolvedValue(undefined);
    const resultReportUpdate = vi.fn().mockResolvedValue(undefined);
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const auditFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "audit-1",
          targetId: "report-1",
          createdAt: new Date("2026-04-19T10:00:00.000Z"),
          metadataJson: {
            sourceMatchId: "m1",
            winnerRegistrationId: "r1",
            snapshotBefore: {
              format: "SINGLE_ELIMINATION",
              rounds: [],
              matches: {
                m1: {
                  id: "m1",
                  side: "WINNERS",
                  roundNumber: 1,
                  sequence: 1,
                  bestOf: 3,
                  status: "READY",
                  slots: [
                    { entrantId: "r1", sourceMatchId: null, sourceOutcome: null, isBye: false },
                    { entrantId: "r2", sourceMatchId: null, sourceOutcome: null, isBye: false }
                  ],
                  winnerId: null,
                  loserId: null,
                  nextMatchId: "m2",
                  nextMatchSlot: 0,
                  loserNextMatchId: null,
                  loserNextMatchSlot: null,
                  resetOfMatchId: null
                },
                m2: {
                  id: "m2",
                  side: "WINNERS",
                  roundNumber: 2,
                  sequence: 1,
                  bestOf: 3,
                  status: "PENDING",
                  slots: [
                    { entrantId: null, sourceMatchId: "m1", sourceOutcome: "WINNER", isBye: false },
                    { entrantId: "r3", sourceMatchId: null, sourceOutcome: null, isBye: false }
                  ],
                  winnerId: null,
                  loserId: null,
                  nextMatchId: null,
                  nextMatchSlot: null,
                  loserNextMatchId: null,
                  loserNextMatchSlot: null,
                  resetOfMatchId: null
                }
              },
              championId: null,
              isFinalized: false,
              metadata: {
                hasGrandFinalReset: false,
                initialEntrantCount: 3,
                bracketSize: 4
              }
            }
          }
        }
      ])
      .mockResolvedValueOnce([]);

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
              status: RegistrationStatus.ACTIVE,
              participant: { discordUserId: "u1", displayName: "Player One" }
            },
            {
              id: "r2",
              participantId: "p2",
              status: RegistrationStatus.ACTIVE,
              participant: { discordUserId: "u2", displayName: "Player Two" }
            },
            {
              id: "r3",
              participantId: "p3",
              status: RegistrationStatus.ACTIVE,
              participant: { discordUserId: "u3", displayName: "Player Three" }
            }
          ],
          resultReports: [],
          brackets: [
            {
              rounds: [
                {
                  id: "round-1",
                  roundNumber: 1,
                  name: "Round 1",
                  matches: [
                    {
                      id: "m1",
                      bracketType: "WINNERS",
                      sequence: 1,
                      bestOf: 3,
                      status: MatchStatus.COMPLETED,
                      version: 1,
                      player1RegistrationId: "r1",
                      player2RegistrationId: "r2",
                      winnerRegistrationId: "r1",
                      loserRegistrationId: "r2",
                      nextMatchId: "m2",
                      nextMatchSlot: 0,
                      loserNextMatchId: null,
                      loserNextMatchSlot: null,
                      resetOfMatchId: null,
                      completedAt: new Date(),
                      reports: [],
                      games: []
                    }
                  ]
                },
                {
                  id: "round-2",
                  roundNumber: 2,
                  name: "Round 2",
                  matches: [
                    {
                      id: "m2",
                      bracketType: "WINNERS",
                      sequence: 1,
                      bestOf: 3,
                      status: MatchStatus.READY,
                      version: 1,
                      player1RegistrationId: "r1",
                      player2RegistrationId: "r3",
                      winnerRegistrationId: null,
                      loserRegistrationId: null,
                      nextMatchId: null,
                      nextMatchSlot: null,
                      loserNextMatchId: null,
                      loserNextMatchSlot: null,
                      resetOfMatchId: null,
                      completedAt: null,
                      reports: [],
                      games: []
                    }
                  ]
                }
              ]
            }
          ],
          waitlistEntries: [],
          auditLogs: []
        })
      },
      auditLog: {
        findMany: auditFindMany,
        create: auditCreate
      },
      match: {
        update: matchUpdate
      },
      resultReport: {
        update: resultReportUpdate
      }
    };

    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));

    const service = new MatchReportingService({} as never);
    vi.spyOn(service as never, "resetPlacementsFromSnapshotTx").mockResolvedValue(undefined);

    const result = await service.setPlayerBackBySelection({
      guildId: "g1",
      tournamentId: "t1",
      actorUserId: "mod-1",
      targetPlayerName: "Player One"
    });

    expect(matchUpdate).toHaveBeenCalledTimes(2);
    expect(resultReportUpdate).toHaveBeenCalledWith({
      where: { id: "report-1" },
      data: {
        status: MatchStatus.CANCELLED,
        reason: "Moved back by staff"
      }
    });
    expect(result).toEqual({ targetPlayerName: "Player One" });
  });
});
