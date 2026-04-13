import type { CacheType, ChatInputCommandInteraction, Interaction } from "discord.js";

import type { BootstrapContext } from "./types.js";

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
    context.logger.error(
      {
        error,
        interactionId: interaction.id,
        interactionType: interaction.type
      },
      "Interaction handling failed"
    );

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "An unexpected error occurred while handling this interaction.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "An unexpected error occurred while handling this interaction.",
          ephemeral: true
        });
      }
    }
  }
};
