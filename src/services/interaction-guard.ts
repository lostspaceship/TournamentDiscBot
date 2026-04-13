import { Collection, type BaseInteraction } from "discord.js";

import { env } from "../config/env.js";
import { ConflictError } from "../utils/errors.js";

export class InteractionGuard {
  private readonly commandTimestamps = new Collection<string, number>();

  private readonly seenInteractionKeys = new Collection<string, number>();

  public assertCooldown(interaction: BaseInteraction): void {
    if (!interaction.guildId || !interaction.user) {
      throw new ConflictError("This action is only available in a guild.");
    }

    const key = `${interaction.guildId}:${interaction.user.id}:${interaction.type}`;
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
    if (seenAt && now - seenAt < 5 * 60 * 1000) {
      throw new ConflictError("This interaction has already been processed.");
    }

    this.seenInteractionKeys.set(key, now);
  }
}
