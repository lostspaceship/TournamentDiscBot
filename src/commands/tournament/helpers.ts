import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { z } from "zod";

import type { BootstrapContext } from "../../bootstrap/types.js";
import { isUnknownInteractionError } from "../../utils/discord-api-errors.js";
import { AppError, NotFoundError, ValidationError } from "../../utils/errors.js";

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

  try {
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
  } catch (replyError) {
    if (isUnknownInteractionError(replyError)) {
      return;
    }

    throw replyError;
  }
};

export const resolveTournamentReference = async (
  context: BootstrapContext,
  guildId: string,
  reference?: string | null
): Promise<string> => {
  if (!reference || reference.trim().length === 0) {
    const defaultTournament = await context.adminTournamentService.resolveDefaultTournament(guildId);
    if (!defaultTournament) {
      throw new NotFoundError("No active tournament found.");
    }

    return defaultTournament;
  }

  const resolved = await context.adminTournamentService.resolveTournamentReference(guildId, reference);

  if (!resolved) {
    throw new NotFoundError("Tournament not found. Use the tournament name or slug.");
  }

  return resolved;
};
