import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { z } from "zod";

import type { BootstrapContext } from "../../bootstrap/types.js";
import { AppError, ValidationError } from "../../utils/errors.js";

export interface TournamentCommandContext {
  interaction: ChatInputCommandInteraction;
  context: BootstrapContext;
  guildId: string;
  member: GuildMember;
}

export const parseInput = <T>(schema: z.ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value);
  } catch {
    throw new ValidationError("One or more command inputs are invalid.");
  }
};

export const replyWithError = async (
  interaction: ChatInputCommandInteraction,
  error: unknown
): Promise<void> => {
  const message =
    error instanceof AppError
      ? error.safeMessage
      : "An unexpected error occurred while handling this command.";

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content: message,
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: message,
    ephemeral: true
  });
};
