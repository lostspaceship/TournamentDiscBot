import { ChannelType, GuildMember } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { BootstrapContext } from "../src/bootstrap/types.js";
import { executeSocialsCommand } from "../src/commands/socials/execute.js";

const createMember = (): GuildMember => Object.create(GuildMember.prototype) as GuildMember;

describe("executeSocialsCommand", () => {
  it("posts a socials embed with markdown links and a hero image", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: "guild-1",
      member: createMember(),
      channel: {
        id: "channel-1",
        type: ChannelType.GuildText,
        isSendable: () => true,
        send
      },
      user: { id: "user-1" },
      options: {
        getSubcommand: vi.fn().mockReturnValue("create"),
        getString: vi.fn((name: string, required?: boolean) => {
          if (name === "links") {
            return "Twitch - https://twitch.tv/test\nInstagram - https://instagram.com/test";
          }
          if (name === "title") return "V222's Socials";
          if (name === "hero_image_url") return "https://cdn.example.com/socials-banner.png";
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

    await executeSocialsCommand(interaction as never, context as BootstrapContext);

    expect(send.mock.calls[0]?.[0].embeds[0].toJSON()).toMatchObject({
      title: "V222's Socials",
      description: "- [Twitch](https://twitch.tv/test)\n- [Instagram](https://instagram.com/test)",
      image: { url: "https://cdn.example.com/socials-banner.png" }
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Posted the socials section in <#channel-1>.",
      ephemeral: true
    });
  });

  it("supports grouped links on one platform line", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: "guild-1",
      member: createMember(),
      channel: {
        id: "channel-1",
        type: ChannelType.GuildText,
        isSendable: () => true,
        send
      },
      user: { id: "user-1" },
      options: {
        getSubcommand: vi.fn().mockReturnValue("create"),
        getString: vi.fn((name: string, required?: boolean) => {
          if (name === "links") {
            return "TikTok - Main=https://tiktok.com/@main | Clipping=https://tiktok.com/@clips";
          }
          if (name === "title") return "V222's Socials";
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

    await executeSocialsCommand(interaction as never, context as BootstrapContext);

    expect(send.mock.calls[0]?.[0].embeds[0].toJSON()).toMatchObject({
      description: "- TikTok: [Main](https://tiktok.com/@main) | [Clipping](https://tiktok.com/@clips)"
    });
  });

  it("supports comma-separated input and merges TikTok variants", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: "guild-1",
      member: createMember(),
      channel: {
        id: "channel-1",
        type: ChannelType.GuildText,
        isSendable: () => true,
        send
      },
      user: { id: "user-1" },
      options: {
        getSubcommand: vi.fn().mockReturnValue("create"),
        getString: vi.fn((name: string, required?: boolean) => {
          if (name === "links") {
            return "Twitch - https://twitch.tv/test, Official Tiktok - https://tiktok.com/@official, Daily Clips Tiktok - https://tiktok.com/@clips, Instagram - https://instagram.com/test";
          }
          if (name === "title") return "V222's Socials";
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

    await executeSocialsCommand(interaction as never, context as BootstrapContext);

    expect(send.mock.calls[0]?.[0].embeds[0].toJSON()).toMatchObject({
      description: "- [Twitch](https://twitch.tv/test)\n- [Instagram](https://instagram.com/test)\n- TikTok: [Official](https://tiktok.com/@official) | [Daily Clips](https://tiktok.com/@clips)"
    });
  });
});
