import { ChannelType, GuildMember } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { BootstrapContext } from "../src/bootstrap/types.js";
import { executeRulesCommand } from "../src/commands/rules/execute.js";

const createMember = (): GuildMember => Object.create(GuildMember.prototype) as GuildMember;

describe("executeRulesCommand", () => {
  it("posts a server rules embed with a hero image", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: "guild-1",
      member: createMember(),
      channel: {
        id: "channel-1",
        type: ChannelType.GuildText,
        isTextBased: () => true,
        isSendable: () => true,
        send
      },
      user: { id: "user-1" },
      options: {
        getSubcommand: vi.fn().mockReturnValue("create"),
        getString: vi.fn((name: string, required?: boolean) => {
          if (name === "text") return "No racism\nNo nsfw\nNo cringe";
          if (name === "title") return "Server Rules";
          if (name === "hero_image_url") return "https://cdn.example.com/rules-banner.png";
          if (required) throw new Error(`Missing option ${name}`);
          return null;
        }),
        getChannel: vi.fn().mockReturnValue(null)
      },
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined)
    };

    const context = {
      permissionService: {
        requireMinimumRole: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as Pick<BootstrapContext, "permissionService">;

    await executeRulesCommand(interaction as never, context as BootstrapContext);

    expect(context.permissionService.requireMinimumRole).toHaveBeenCalledWith(
      "guild-1",
      interaction.member,
      "ADMIN",
      "command.rules.create"
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      allowedMentions: { parse: [] }
    });
    expect(send.mock.calls[0]?.[0].embeds[0].toJSON()).toMatchObject({
      title: "Server Rules",
      description: "- No racism\n- No nsfw\n- No cringe",
      image: { url: "https://cdn.example.com/rules-banner.png" }
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Posted the rules section in <#channel-1>.",
      ephemeral: true
    });
  });

  it("renders each rule on its own line from sentence-style input", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: "guild-1",
      member: createMember(),
      channel: {
        id: "channel-1",
        type: ChannelType.GuildText,
        isTextBased: () => true,
        isSendable: () => true,
        send
      },
      user: { id: "user-1" },
      options: {
        getSubcommand: vi.fn().mockReturnValue("create"),
        getString: vi.fn((name: string, required?: boolean) => {
          if (name === "text") return "No racism. No spam. Be normal.";
          if (name === "title") return "Rules";
          if (name === "hero_image_url") return null;
          if (required) throw new Error(`Missing option ${name}`);
          return null;
        }),
        getChannel: vi.fn().mockReturnValue(null)
      },
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined)
    };

    const context = {
      permissionService: {
        requireMinimumRole: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as Pick<BootstrapContext, "permissionService">;

    await executeRulesCommand(interaction as never, context as BootstrapContext);

    expect(send.mock.calls[0]?.[0].embeds[0].toJSON()).toMatchObject({
      description: "- No racism.\n- No spam.\n- Be normal."
    });
  });
});
