import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tournament: {
      update: vi.fn()
    }
  }
}));

vi.mock("../src/config/prisma.js", () => ({
  prisma: prismaMock
}));

import { BracketSyncService } from "../src/services/bracket-sync-service.js";

describe("BracketSyncService", () => {
  beforeEach(() => {
    prismaMock.tournament.update.mockReset();
  });

  it("posts info and bracket messages and stores the tracked ids", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: "info-message-1" })
      .mockResolvedValueOnce({ id: "bracket-message-1" });
    const repo = {
      async getTournament() {
        return {
          id: "t1",
          guildId: "g1",
          name: "Render Cup",
          slug: "render-cup",
          gameTitle: null,
          status: "REGISTRATION_OPEN",
          format: "SINGLE_ELIMINATION",
          bestOfDefault: 3,
          requireCheckIn: false,
          allowWaitlist: false,
          bracketViewTab: "WINNERS",
          bracketViewPage: 1,
          infoMessageChannelId: null,
          infoMessageId: null,
          bracketMessageChannelId: null,
          bracketMessageId: null,
          settings: {
            seedingMethod: "RANDOM",
            grandFinalResetEnabled: true
          },
          registrations: [
            {
              id: "r1",
              participant: { displayName: "Alpha", rating: null, discordUserId: "100000000000000001", opggProfile: null },
              participantId: "p1",
              joinedAt: new Date(),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            },
            {
              id: "r2",
              participant: { displayName: "Bravo", rating: null, discordUserId: "100000000000000002", opggProfile: null },
              participantId: "p2",
              joinedAt: new Date(),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            }
          ],
          brackets: [],
          waitlistEntries: [],
          auditLogs: []
        };
      }
    };
    const guildConfigRepository = {
      async getOrCreate() {
        return { tournamentAnnouncementChannelId: "channel-1" };
      }
    };
    const client = {
      channels: {
        async fetch() {
          return {
            type: 0,
            isTextBased: () => true,
            isSendable: () => true,
            messages: {
              fetch: vi.fn()
            },
            send
          };
        }
      }
    };
    const renderer = {
      renderPng: vi.fn().mockReturnValue(Buffer.from("png"))
    };

    const service = new BracketSyncService(
      client as never,
      { warn: vi.fn(), error: vi.fn() } as never,
      repo as never,
      guildConfigRepository as never,
      renderer as never
    );

    await service.syncTournamentBracket("t1");

    expect(send).toHaveBeenCalledTimes(2);
    expect(prismaMock.tournament.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: expect.objectContaining({
          infoMessageChannelId: "channel-1",
          infoMessageId: "info-message-1",
          bracketMessageChannelId: "channel-1",
          bracketMessageId: "bracket-message-1",
          bracketViewTab: "WINNERS",
          bracketViewPage: 1
        })
      })
    );
  });

  it("persists bracket tab and page state when a bracket view interaction changes it", async () => {
    const repo = {
      async getTournament() {
        return {
          id: "t1",
          guildId: "g1",
          name: "Render Cup",
          slug: "render-cup",
          status: "REGISTRATION_OPEN",
          format: "SINGLE_ELIMINATION",
          bestOfDefault: 3,
          requireCheckIn: false,
          allowWaitlist: false,
          bracketViewTab: "WINNERS",
          bracketViewPage: 1,
          settings: {
            seedingMethod: "RANDOM",
            grandFinalResetEnabled: true
          },
          registrations: [
            {
              id: "r1",
              participant: { displayName: "Alpha", rating: null, discordUserId: "100000000000000001", opggProfile: null },
              participantId: "p1",
              joinedAt: new Date(),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            },
            {
              id: "r2",
              participant: { displayName: "Bravo", rating: null, discordUserId: "100000000000000002", opggProfile: null },
              participantId: "p2",
              joinedAt: new Date(),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            }
          ],
          brackets: [],
          waitlistEntries: [],
          auditLogs: []
        };
      },
      updateBracketViewState: vi.fn().mockResolvedValue({})
    };

    const service = new BracketSyncService(
      { channels: { fetch: vi.fn() } } as never,
      { warn: vi.fn(), error: vi.fn() } as never,
      repo as never,
      { getOrCreate: vi.fn() } as never,
      { renderPng: vi.fn().mockReturnValue(Buffer.from("png")) } as never
    );

    await service.buildBracketMessagePayload("t1", "PLACEMENTS", 9, { persistState: true });

    expect(repo.updateBracketViewState).toHaveBeenCalledWith("t1", {
      tab: "PLACEMENTS",
      page: 1
    });
  });

  it("renders single-entrant preview cards as pending instead of completed wins", async () => {
    const renderer = {
      renderPng: vi.fn().mockReturnValue(Buffer.from("png"))
    };
    const repo = {
      async getTournament() {
        return {
          id: "t1",
          guildId: "g1",
          name: "Preview Cup",
          slug: "preview-cup",
          status: "REGISTRATION_OPEN",
          format: "SINGLE_ELIMINATION",
          bestOfDefault: 3,
          requireCheckIn: false,
          allowWaitlist: false,
          bracketViewTab: "WINNERS",
          bracketViewPage: 1,
          settings: {
            seedingMethod: "RANDOM",
            grandFinalResetEnabled: true
          },
          registrations: [
            {
              id: "r1",
              participant: { displayName: "Alpha", rating: null, discordUserId: "100000000000000001", opggProfile: null },
              participantId: "p1",
              joinedAt: new Date("2026-04-16T00:00:01Z"),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            },
            {
              id: "r2",
              participant: { displayName: "Bravo", rating: null, discordUserId: "100000000000000002", opggProfile: null },
              participantId: "p2",
              joinedAt: new Date("2026-04-16T00:00:02Z"),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            },
            {
              id: "r3",
              participant: { displayName: "Charlie", rating: null, discordUserId: "100000000000000003", opggProfile: null },
              participantId: "p3",
              joinedAt: new Date("2026-04-16T00:00:03Z"),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            }
          ],
          brackets: [],
          waitlistEntries: [],
          auditLogs: []
        };
      },
      updateBracketViewState: vi.fn().mockResolvedValue({})
    };

    const service = new BracketSyncService(
      { channels: { fetch: vi.fn() } } as never,
      { warn: vi.fn(), error: vi.fn() } as never,
      repo as never,
      { getOrCreate: vi.fn() } as never,
      renderer as never
    );

    await service.buildBracketMessagePayload("t1", "WINNERS", 1, { persistState: false });

    const renderModel = renderer.renderPng.mock.calls[0]?.[0];
    expect(
      renderModel.pageModel.rounds[0].matches
        .filter((match: { player1Name: string; player2Name: string }) =>
          [match.player1Name, match.player2Name].filter(Boolean).length === 1
        )
        .every((match: { status: string }) => match.status === "PENDING")
    ).toBe(true);
  });

  it("renders only winners round 1 in preview mode instead of downstream empty rounds", async () => {
    const renderer = {
      renderPng: vi.fn().mockReturnValue(Buffer.from("png"))
    };
    const repo = {
      async getTournament() {
        return {
          id: "t1",
          guildId: "g1",
          name: "Preview Cup",
          slug: "preview-cup",
          status: "REGISTRATION_OPEN",
          format: "SINGLE_ELIMINATION",
          bestOfDefault: 3,
          requireCheckIn: false,
          allowWaitlist: false,
          bracketViewTab: "WINNERS",
          bracketViewPage: 1,
          settings: {
            seedingMethod: "RANDOM",
            grandFinalResetEnabled: true
          },
          registrations: Array.from({ length: 19 }, (_, index) => ({
            id: `r${index + 1}`,
            participant: {
              displayName: `Player ${index + 1}`,
              rating: null,
              discordUserId: `${100000000000000000n + BigInt(index + 1)}`,
              opggProfile: null
            },
            participantId: `p${index + 1}`,
            joinedAt: new Date(`2026-04-16T00:00:${String(index).padStart(2, "0")}Z`),
            status: "ACTIVE",
            seed: null,
            checkIn: null
          })),
          brackets: [],
          waitlistEntries: [],
          auditLogs: []
        };
      },
      updateBracketViewState: vi.fn().mockResolvedValue({})
    };

    const service = new BracketSyncService(
      { channels: { fetch: vi.fn() } } as never,
      { warn: vi.fn(), error: vi.fn() } as never,
      repo as never,
      { getOrCreate: vi.fn() } as never,
      renderer as never
    );

    await service.buildBracketMessagePayload("t1", "WINNERS", 1, { persistState: false });

    const renderModel = renderer.renderPng.mock.calls[0]?.[0];
    expect(renderModel.pageModel.rounds).toHaveLength(1);
    expect(renderModel.pageModel.rounds[0].roundNumber).toBe(1);
    expect(renderModel.pageModel.rounds[0].side).toBe("WINNERS");
  });
});
