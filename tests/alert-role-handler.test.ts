import { describe, expect, it, vi } from "vitest";

import { buildSignedCustomId } from "../src/interactions/secure-payload.js";
import { alertRoleHandler } from "../src/interactions/alert-role-handler.js";

describe("alertRoleHandler", () => {
  it("adds a role when the member does not have it", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      id: "interaction-1",
      customId: buildSignedCustomId("alerts", "toggle-role", "guild-1|TWITCH|role-1", "toggle1"),
      guildId: "guild-1",
      guild: {
        members: {
          fetch: vi.fn().mockResolvedValue({
            roles: {
              cache: new Map(),
              add,
              remove
            }
          })
        }
      },
      user: { id: "user-1" },
      isButton: () => true,
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined)
    };

    await alertRoleHandler.handle(interaction as never, {
      logger: { warn: vi.fn() }
    } as never);

    expect(add).toHaveBeenCalledWith("role-1");
    expect(remove).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "TWITCH alerts enabled.",
      ephemeral: true
    });
  });
});
