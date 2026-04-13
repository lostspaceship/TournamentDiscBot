import type { GuardedInteraction } from "./types.js";

export const replyPermissionDenied = async (
  interaction: GuardedInteraction,
  message = "You do not have permission to perform this action."
): Promise<void> => {
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
