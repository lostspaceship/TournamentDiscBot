import type { CacheType, ChatInputCommandInteraction } from "discord.js";
import type { ZodSchema } from "zod";

import type { BootstrapContext } from "../../bootstrap/types.js";
import { AppError, NotFoundError, ValidationError } from "../../utils/errors.js";

export const parseInput = <T>(schema: ZodSchema<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Check those fields and try again.");
  }

  return parsed.data;
};

export const resolveTournamentReference = async (
  context: BootstrapContext,
  guildId: string,
  reference: string | null
): Promise<string> => {
  const tournamentId =
    reference == null
      ? await context.adminTournamentService.resolveDefaultTournament(guildId)
      : await context.adminTournamentService.resolveTournamentReference(guildId, reference);

  if (!tournamentId) {
    throw new NotFoundError(reference == null ? "No active tournament." : "Tournament not found.");
  }

  return tournamentId;
};

export const replyWithError = async (
  interaction: ChatInputCommandInteraction<CacheType>,
  error: unknown
): Promise<void> => {
  const message =
    error instanceof AppError ? error.safeMessage : "Couldn't complete that.";

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message });
    return;
  }

  await interaction.reply({ content: message, ephemeral: true });
};
