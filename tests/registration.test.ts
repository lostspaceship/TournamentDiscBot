import { RegistrationStatus, TournamentStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn()
  }
}));

vi.mock("../src/config/prisma.js", () => ({
  prisma: prismaMock
}));

import { RegistrationService } from "../src/services/registration-service.js";

describe("RegistrationService", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
  });

  it("prevents duplicate signups", async () => {
    const tx = {
      $queryRaw: vi.fn(),
      tournament: {
        findUnique: vi.fn().mockResolvedValue({
          id: "t1",
          guildId: "g1",
          status: TournamentStatus.REGISTRATION_OPEN,
          mutualExclusionKey: null,
          maxParticipants: 16,
          allowWaitlist: true,
          registrations: [
            {
              participantId: "p1",
              status: RegistrationStatus.ACTIVE,
              participant: { discordUserId: "user-1" }
            }
          ],
          waitlistEntries: []
        })
      },
      participant: {
        upsert: vi.fn().mockResolvedValue({ id: "p1" })
      }
    };

    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));

    const service = new RegistrationService({} as never);

    await expect(
      service.joinTournament({
        guildId: "g1",
        tournamentId: "t1",
        actorUserId: "user-1",
        displayName: "User 1",
        opggProfile: "user1"
      })
    ).rejects.toThrowError(/already registered/i);
  });

  it("routes overflow signups to the waitlist when enabled", async () => {
    const waitlistCreate = vi.fn().mockResolvedValue({
      id: "w1",
      position: 1
    });

    const tx = {
      $queryRaw: vi.fn(),
      tournament: {
        findUnique: vi.fn().mockResolvedValue({
          id: "t1",
          guildId: "g1",
          status: TournamentStatus.REGISTRATION_OPEN,
          mutualExclusionKey: null,
          maxParticipants: 1,
          allowWaitlist: true,
          registrations: [
            {
              participantId: "p-existing",
              status: RegistrationStatus.ACTIVE,
              participant: { discordUserId: "someone-else" }
            }
          ],
          waitlistEntries: []
        })
      },
      participant: {
        upsert: vi.fn().mockResolvedValue({ id: "p2" })
      },
      registration: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      waitlistEntry: {
        create: waitlistCreate
      },
      auditLog: {
        create: vi.fn()
      }
    };

    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx));

    const service = new RegistrationService({} as never);

    const result = await service.joinTournament({
      guildId: "g1",
      tournamentId: "t1",
      actorUserId: "user-2",
      displayName: "User 2",
      opggProfile: "user2"
    });

    expect(result.waitlisted).toBe(true);
    expect(result.waitlistPosition).toBe(1);
    expect(waitlistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tournamentId: "t1",
          participantId: "p2",
          position: 1
        })
      })
    );
  });
});
