import { GuildMember } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { executeTourCommand } from "../src/commands/tour/execute.js";
import type { BootstrapContext } from "../src/bootstrap/types.js";
import { ConflictError } from "../src/utils/errors.js";

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
      startTournament: vi.fn().mockResolvedValue(undefined),
      rollbackTournamentStart: vi.fn().mockResolvedValue(undefined),
      switchBracketNames: vi.fn().mockResolvedValue(undefined),
      renameParticipant: vi.fn().mockResolvedValue(undefined)
    },
    registrationService: {
      addParticipantByStaff: vi.fn().mockResolvedValue({
        waitlisted: false
      }),
      leaveTournament: vi.fn().mockResolvedValue({
        leftWaitlist: false
      })
    },
    matchReportingService: {
      undoLatestManualAdvance: vi.fn().mockResolvedValue({
        reportId: "report-1"
      }),
      kickParticipantBySelection: vi.fn().mockResolvedValue({
        targetPlayerName: "Test Player 12",
        advancedOpponentName: "Test Player 18"
      }),
      setPlayerBackBySelection: vi.fn().mockResolvedValue({
        targetPlayerName: "Test Player 12"
      }),
      manualAdvanceBySelection: vi.fn().mockResolvedValue({
        finalized: false,
        reportId: "report-1"
      })
    }
  }) as unknown as Pick<
    BootstrapContext,
    "permissionService" | "adminTournamentService" | "registrationService" | "matchReportingService"
  >;

describe("executeTourCommand", () => {
  it("defers and edits the reply for start", async () => {
    const interaction = createBaseInteraction("start");
    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.adminTournamentService.startTournament).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1"
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Tournament started."
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("adds a player on behalf of a Discord user", async () => {
    const interaction = createBaseInteraction("add");
    interaction.options.getUser = vi.fn((name: string) => {
      if (name === "user") return { id: "user-2" };
      return null;
    });
    interaction.options.getString = vi.fn((name: string) => {
      if (name === "name") return "Test Player 12";
      if (name === "league_ign") return "test#bot";
      return null;
    });

    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(context.registrationService.addParticipantByStaff).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1",
      targetUserId: "user-2",
      displayName: "Test Player 12",
      opggProfile: "test#bot"
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Player added.",
      ephemeral: true
    });
  });

  it("defers and edits the reply for unstart", async () => {
    const interaction = createBaseInteraction("unstart");
    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.adminTournamentService.rollbackTournamentStart).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1"
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Registration is open again."
    });
  });

  it("defers and edits the reply for manual advance", async () => {
    const interaction = createBaseInteraction("advance");
    interaction.options.getString = vi.fn((name: string) => {
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
      targetPlayerName: "Test Player 12",
      idempotencyKey: "interaction-1"
    });
    expect(interaction.editReply).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("defers and edits the reply for kick", async () => {
    const interaction = createBaseInteraction("kick");
    interaction.options.getString = vi.fn((name: string) => {
      if (name === "name") return "Test Player 12";
      return null;
    });

    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.matchReportingService.kickParticipantBySelection).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1",
      targetPlayerName: "Test Player 12"
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Removed Test Player 12. Test Player 18 advances."
    });
  });

  it("defers and edits the reply for back", async () => {
    const interaction = createBaseInteraction("back");
    interaction.options.getString = vi.fn((name: string) => {
      if (name === "name") return "Test Player 12";
      return null;
    });

    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.matchReportingService.setPlayerBackBySelection).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1",
      targetPlayerName: "Test Player 12"
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Moved Test Player 12 back one match."
    });
  });

  it("falls back to bracket-aware leave after the tournament starts", async () => {
    const interaction = createBaseInteraction("leave");
    const context = createContext();
    context.registrationService.leaveTournament = vi
      .fn()
      .mockRejectedValue(new ConflictError("You can only leave while registration is open."));

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.matchReportingService.kickParticipantBySelection).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1",
      targetUserId: "user-1"
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You left the tournament. Test Player 18 advances."
    });
  });

  it("swaps two bracket names before start", async () => {
    const interaction = createBaseInteraction("switch");
    interaction.options.getString = vi.fn((name: string) => {
      if (name === "name_one") return "Test Player 12";
      if (name === "name_two") return "Test Player 18";
      return null;
    });

    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(context.adminTournamentService.switchBracketNames).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1",
      firstPlayerName: "Test Player 12",
      secondPlayerName: "Test Player 18"
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Switched Test Player 12 and Test Player 18.",
      ephemeral: true
    });
  });

  it("renames a player", async () => {
    const interaction = createBaseInteraction("rename");
    interaction.options.getString = vi.fn((name: string) => {
      if (name === "name") return "Test Player 12";
      if (name === "new_name") return "Renamed Player";
      return null;
    });

    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(context.adminTournamentService.renameParticipant).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1",
      currentPlayerName: "Test Player 12",
      nextPlayerName: "Renamed Player"
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Renamed Test Player 12 to Renamed Player.",
      ephemeral: true
    });
  });

  it("defers and edits the reply for undo", async () => {
    const interaction = createBaseInteraction("undo");
    const context = createContext();

    await executeTourCommand(interaction as never, context as BootstrapContext);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(context.matchReportingService.undoLatestManualAdvance).toHaveBeenCalledWith({
      guildId: "guild-1",
      tournamentId: "tour-1",
      actorUserId: "user-1"
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Undid advance report-1."
    });
  });

});
