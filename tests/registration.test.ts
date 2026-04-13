import { TournamentStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { TournamentService } from "../src/services/tournament-service.js";

describe("TournamentService registration logic", () => {
  it("prevents duplicate signups", async () => {
    const service = new TournamentService(
      {} as any,
      {
        async getTournament() {
          return {
            id: "t1",
            guildId: "g1",
            status: TournamentStatus.REGISTRATION_OPEN,
            mutualExclusionKey: null,
            maxParticipants: 16,
            allowWaitlist: true,
            registrations: [
              {
                status: "ACTIVE",
                participant: { discordUserId: "user-1" }
              }
            ]
          };
        },
        async createOrGetParticipant() {
          return { id: "p1" };
        }
      } as any,
      {} as any
    );

    await expect(
      service.joinTournament({
        guildId: "g1",
        tournamentId: "t1",
        userId: "user-1",
        displayName: "User 1"
      })
    ).rejects.toThrowError(/already registered/i);
  });

  it("routes overflow signups to the waitlist when enabled", async () => {
    const joinTournament = vi.fn();
    const service = new TournamentService(
      {} as any,
      {
        async getTournament() {
          return {
            id: "t1",
            guildId: "g1",
            status: TournamentStatus.REGISTRATION_OPEN,
            mutualExclusionKey: null,
            maxParticipants: 1,
            allowWaitlist: true,
            registrations: [
              {
                status: "ACTIVE",
                participant: { discordUserId: "someone-else" }
              }
            ]
          };
        },
        async createOrGetParticipant() {
          return { id: "p2" };
        },
        joinTournament,
        async writeAuditLog() {
          return undefined;
        }
      } as any,
      {} as any
    );

    const result = await service.joinTournament({
      guildId: "g1",
      tournamentId: "t1",
      userId: "user-2",
      displayName: "User 2"
    });

    expect(result.waitlist).toBe(true);
    expect(joinTournament).toHaveBeenCalledWith(
      expect.objectContaining({
        waitlist: true
      })
    );
  });
});
