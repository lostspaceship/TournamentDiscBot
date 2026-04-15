import { Collection, type BaseInteraction } from "discord.js";

import { env } from "../config/env.js";
import { ConflictError } from "../utils/errors.js";

export class InteractionGuard {
  private readonly commandTimestamps = new Collection<string, number>();

  private readonly seenInteractionKeys = new Collection<string, number>();

  private readonly userRateWindows = new Collection<string, number[]>();

  private readonly guildRateWindows = new Collection<string, number[]>();

  private readonly staleThresholdMs = env.INTERACTION_TTL_MS;

  public assertProcessable(interaction: BaseInteraction): void {
    this.assertGuildScoped(interaction);
    this.assertInteractionFresh(interaction);
    this.assertIdempotency(`discord:${interaction.id}`);
    this.assertCooldown(interaction);
    this.assertRateLimit(interaction);
    this.prune();
  }

  public assertCooldown(interaction: BaseInteraction): void {
    if (!interaction.guildId || !interaction.user) {
      throw new ConflictError("This action is only available in a guild.");
    }

    const commandName =
      interaction.isChatInputCommand() || interaction.isAutocomplete()
        ? interaction.commandName
        : "component";
    const key = `${interaction.guildId}:${interaction.user.id}:${commandName}`;
    const now = Date.now();
    const previous = this.commandTimestamps.get(key);

    if (previous && now - previous < env.COMMAND_COOLDOWN_MS) {
      throw new ConflictError("You are doing that too quickly. Please wait a moment.");
    }

    this.commandTimestamps.set(key, now);
  }

  public assertIdempotency(key: string): void {
    const now = Date.now();
    const seenAt = this.seenInteractionKeys.get(key);
    if (seenAt && now - seenAt < env.IDEMPOTENCY_TTL_MS) {
      throw new ConflictError("This interaction has already been processed.");
    }

    this.seenInteractionKeys.set(key, now);
  }

  private assertGuildScoped(interaction: BaseInteraction): void {
    if (!interaction.guildId || !interaction.user) {
      throw new ConflictError("This action is only available in a guild.");
    }
  }

  private assertInteractionFresh(interaction: BaseInteraction): void {
    const interactionTimestamp = DiscordSnowflake.timestampFrom(interaction.id);
    if (Date.now() - interactionTimestamp > this.staleThresholdMs) {
      throw new ConflictError("This interaction is stale. Please run the command again.");
    }
  }

  private assertRateLimit(interaction: BaseInteraction): void {
    if (!interaction.guildId || !interaction.user) {
      throw new ConflictError("This action is only available in a guild.");
    }

    const now = Date.now();
    const userKey = `${interaction.guildId}:${interaction.user.id}`;
    const guildKey = interaction.guildId;

    const userWindow = (this.userRateWindows.get(userKey) ?? []).filter(
      (timestamp) => now - timestamp < env.COMMAND_BURST_WINDOW_MS
    );
    if (userWindow.length >= env.COMMAND_BURST_LIMIT) {
      throw new ConflictError("You are sending commands too quickly. Please slow down.");
    }
    userWindow.push(now);
    this.userRateWindows.set(userKey, userWindow);

    const guildWindow = (this.guildRateWindows.get(guildKey) ?? []).filter(
      (timestamp) => now - timestamp < env.GUILD_BURST_WINDOW_MS
    );
    if (guildWindow.length >= env.GUILD_BURST_LIMIT) {
      throw new ConflictError("This server is hitting the command rate limit. Please retry shortly.");
    }
    guildWindow.push(now);
    this.guildRateWindows.set(guildKey, guildWindow);
  }

  private prune(): void {
    const now = Date.now();

    for (const [key, value] of this.seenInteractionKeys.entries()) {
      if (now - value >= env.IDEMPOTENCY_TTL_MS) {
        this.seenInteractionKeys.delete(key);
      }
    }

    for (const [key, value] of this.commandTimestamps.entries()) {
      if (now - value >= env.COMMAND_BURST_WINDOW_MS) {
        this.commandTimestamps.delete(key);
      }
    }

    for (const [key, value] of this.userRateWindows.entries()) {
      const next = value.filter((timestamp) => now - timestamp < env.COMMAND_BURST_WINDOW_MS);
      if (next.length === 0) {
        this.userRateWindows.delete(key);
      } else {
        this.userRateWindows.set(key, next);
      }
    }

    for (const [key, value] of this.guildRateWindows.entries()) {
      const next = value.filter((timestamp) => now - timestamp < env.GUILD_BURST_WINDOW_MS);
      if (next.length === 0) {
        this.guildRateWindows.delete(key);
      } else {
        this.guildRateWindows.set(key, next);
      }
    }
  }
}

class DiscordSnowflake {
  private static readonly epoch = 1420070400000n;

  public static timestampFrom(id: string): number {
    return Number((BigInt(id) >> 22n) + this.epoch);
  }
}
