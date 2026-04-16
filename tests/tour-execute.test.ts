import { GuildMember } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { executeTourCommand } from "../src/commands/tour/execute.js";
import type { BootstrapContext } from "../src/bootstrap/types.js";

const createMember = (): GuildMember => Object.create(GuildMember.prototype) as GuildMember;

const createBaseInteraction = (subcommand: string) => {
  const options = {
    getSubcommand: vi.fn().mockReturnValue(subcommand),
    getString: vi.fn().mockReturnValue(null),
    getChannel: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
    getInteger: vi.fn().mockReturnValue(null),
    getBoolean: vi.fn().mockReturnValue(null)
  };

  return {
    id: "interaction-1",
    guildId: "guild-1",
    member: createMember(),
    user: { id: "user-1" },
    options,
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined)
  };
};

const createContext = () =>
  ({
    permissionService: {
      requireMinimumRole: vi.fn().mockResolvedValue(undefined)
    },
    adminTournamentService: {
      resolveDefaultTournament: vi.fn().mockResolvedValue("tour-1"),
      resolveTournamentReference: vi.fn().mockResolvedValue("tour-1"),
      startTournament: vi.fn().mockResolvedValue(undefined)
    },
    matchReportingService: {
      manualAdvanceBySelection: vi.fn().mockResolvedValue({
        finalized: false,
        reportId: "report-1"
      })
    }
  }) as unknown as Pick<
    BootstrapContext,
    "permissionService" | "adminTournamentService" | "matchReportingService"
  >;

describe("executeTourCommand", () => {
  it("defers and edits the reply for close", async () => {
    const interaction = createBaseInteraction("close");
    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.adminTournamentService.startTournament).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1"
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Registration closed, the bracket is locked, and the tournament is ready for advances."
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("defers and edits the reply for manual advance", async () => {
    const interaction = createBaseInteraction("advance");
    interaction.options.getString = vi.fn((name: string) => {
      if (name === "tournament_id") return null;
      if (name === "name") return "Test Player 12";
      return null;
    });

    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.matchReportingService.manualAdvanceBySelection).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1",
      targetUserId: undefined,
      targetPlayerName: "Test Player 12",
      idempotencyKey: "interaction-1"
    });
    expect(interaction.editReply).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
