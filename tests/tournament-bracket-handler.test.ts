import { describe, expect, it, vi } from "vitest";

import { buildSignedCustomId } from "../src/interactions/secure-payload.js";
import { tournamentBracketHandler } from "../src/interactions/tournament-bracket-handler.js";

describe("tournamentBracketHandler", () => {
  it("handles bracket tab/page button clicks and updates the message with the requested state", async () => {
    const interaction = {
      customId: buildSignedCustomId("bracket", "bn", "t1|WINNERS|2", "x12345"),
      isButton: () => true,
      deferred: false,
      replied: false,
      update: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      followUp: vi.fn()
    };
    const buildBracketMessagePayload = vi.fn().mockResolvedValue({
      embeds: [],
      files: [],
      components: []
    });

    await tournamentBracketHandler.handle(interaction as never, {
      bracketSyncService: {
        buildBracketMessagePayload
      }
    } as never);

    expect(buildBracketMessagePayload).toHaveBeenCalledWith("t1", "WINNERS", 2, {
      persistState: true
    });
    expect(interaction.update).toHaveBeenCalled();
  });
});
