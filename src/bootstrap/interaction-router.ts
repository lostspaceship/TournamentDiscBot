import type { CacheType, ChatInputCommandInteraction, Interaction } from "discord.js";

import type { BootstrapContext } from "./types.js";
import { AppError } from "../utils/errors.js";

const replySafe = async (
  interaction: ChatInputCommandInteraction<CacheType>,
  content: string
): Promise<void> => {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }

  await interaction.reply({ content, ephemeral: true });
};

export const routeInteraction = async (
  interaction: Interaction,
  context: BootstrapContext
): Promise<void> => {
  try {
    if (context.runtime.isShuttingDown) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "The bot is shutting down. Please retry in a moment.",
          ephemeral: true
        });
      }
      return;
    }

    context.interactionGuard.assertProcessable(interaction);

    if (interaction.isChatInputCommand()) {
      const command = context.commands.get(interaction.commandName);
      if (!command) {
        await replySafe(interaction, "This command is not registered.");
        return;
      }

      await command.execute(interaction, context);
      return;
    }

    for (const handler of context.interactionHandlers) {
      if (handler.canHandle(interaction)) {
        await handler.handle(interaction, context);
        return;
      }
    }
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.safeMessage
        : "An unexpected error occurred while handling this interaction.";

    context.logger.error(
      {
        error,
        interactionId: interaction.id,
        interactionType: interaction.type,
        guildId: interaction.guildId,
        userId: interaction.user?.id
      },
      "Interaction handling failed"
    );

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: message,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: message,
          ephemeral: true
        });
      }
    }
  }
};
