import { describe, expect, it } from "vitest";

import { InteractionGuard } from "../src/services/interaction-guard.js";

const toSnowflake = (timestamp: number): string =>
  (((BigInt(timestamp) - 1420070400000n) << 22n) + 1n).toString();

const makeBaseInteraction = (overrides: Record<string, unknown> = {}) => ({
  id: toSnowflake(Date.now()),
  guildId: "guild-1",
  user: { id: "user-1" },
  isChatInputCommand: () => false,
  isAutocomplete: () => false,
  ...overrides
});

describe("InteractionGuard", () => {
  it("does not apply command cooldown to component interactions", () => {
    const guard = new InteractionGuard();
    const first = makeBaseInteraction();
    const second = makeBaseInteraction({ id: toSnowflake(Date.now() + 1) });

    expect(() => guard.assertProcessable(first as never)).not.toThrow();
    expect(() => guard.assertProcessable(second as never)).not.toThrow();
  });

  it("still applies cooldown to repeated slash commands", () => {
    const guard = new InteractionGuard();
    const first = makeBaseInteraction({
      id: toSnowflake(Date.now()),
      isChatInputCommand: () => true,
      commandName: "tour"
    });
    const second = makeBaseInteraction({
      id: toSnowflake(Date.now() + 1),
      isChatInputCommand: () => true,
      commandName: "tour"
    });

    expect(() => guard.assertProcessable(first as never)).not.toThrow();
    expect(() => guard.assertProcessable(second as never)).toThrow(/too quickly/i);
  });
});
