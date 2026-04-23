import { ChannelType, GuildMember } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { BootstrapContext } from "../src/bootstrap/types.js";
import { executeAlertsCommand } from "../src/commands/alerts/execute.js";

const createMember = (): GuildMember => Object.create(GuildMember.prototype) as GuildMember;

describe("executeAlertsCommand", () => {
  it("configures Twitch alerts", async () => {
    const interaction = {
      guildId: "guild-1",
      member: createMember(),
      options: {
        getSubcommand: vi.fn().mockReturnValue("twitch"),
        getChannel: vi.fn().mockReturnValue({ id: "channel-1", type: ChannelType.GuildText }),
        getString: vi.fn((name: string) => (name === "username" ? "v222lol" : null)),
        getRole: vi.fn().mockReturnValue({ id: "role-1" })
      },
      reply: vi.fn().mockResolvedValue(undefined),
      deferred: false,
      replied: false
    };

    const context = {
      permissionService: { requireMinimumRole: vi.fn().mockResolvedValue(undefined) },
      alertAdminService: {
        configureTwitchAlert: vi.fn().mockResolvedValue({
          twitchUsername: "v222lol"
        })
      }
    } as unknown as Pick<BootstrapContext, "permissionService" | "alertAdminService">;

    await executeAlertsCommand(interaction as never, context as BootstrapContext);

    expect(context.alertAdminService.configureTwitchAlert).toHaveBeenCalledWith({
      guildId: "guild-1",
      channelId: "channel-1",
      username: "v222lol",
      roleId: "role-1"
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Twitch alerts enabled for v222lol in <#channel-1>.",
      ephemeral: true
    });
  });

  it("creates the alert role message", async () => {
    const interaction = {
      guildId: "guild-1",
      member: createMember(),
      options: {
        getSubcommand: vi.fn().mockReturnValue("roles"),
        getChannel: vi.fn().mockReturnValue({ id: "channel-1", type: ChannelType.GuildText }),
        getString: vi.fn((name: string) => {
          if (name === "title") return "Pick alerts";
          if (name === "description") return "Choose your pings";
          return null;
        }),
        getRole: vi.fn((name: string) => {
          if (name === "twitch_role") return { id: "role-1" };
          if (name === "youtube_role") return { id: "role-2" };
          return null;
        })
      },
      reply: vi.fn().mockResolvedValue(undefined),
      deferred: false,
      replied: false
    };

    const context = {
      permissionService: { requireMinimumRole: vi.fn().mockResolvedValue(undefined) },
      alertAdminService: {
        postRoleMessage: vi.fn().mockResolvedValue({ id: "message-1" })
      }
    } as unknown as Pick<BootstrapContext, "permissionService" | "alertAdminService">;

    await executeAlertsCommand(interaction as never, context as BootstrapContext);

    expect(context.alertAdminService.postRoleMessage).toHaveBeenCalledWith({
      guildId: "guild-1",
      channelId: "channel-1",
      twitchRoleId: "role-1",
      youtubeRoleId: "role-2",
      title: "Pick alerts",
      description: "Choose your pings"
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Alert role message is ready in <#channel-1> (message-1).",
      ephemeral: true
    });
  });
});
