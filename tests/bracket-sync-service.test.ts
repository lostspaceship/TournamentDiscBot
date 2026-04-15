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
          gameTitle: "League of Legends",
          status: "REGISTRATION_OPEN",
          format: "SINGLE_ELIMINATION",
          bestOfDefault: 3,
          requireCheckIn: false,
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
              participant: { displayName: "Alpha", rating: null },
              participantId: "p1",
              joinedAt: new Date(),
              status: "ACTIVE",
              seed: null,
              checkIn: null
            },
            {
              id: "r2",
              participant: { displayName: "Bravo", rating: null },
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
          bracketMessageId: "bracket-message-1"
        })
      })
    );
  });
});
