import type { Interaction } from "discord.js";

import type { BootstrapContext, InteractionHandlerModule } from "../bootstrap/types.js";
import { parseSignedCustomId } from "./secure-payload.js";
import { AppError, ValidationError } from "../utils/errors.js";

export const alertRoleHandler: InteractionHandlerModule = {
  id: "alert-role-handler",
  canHandle(interaction: Interaction): boolean {
    if (!interaction.isButton()) {
      return false;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId);
      return parsed.namespace === "alerts";
    } catch {
      return false;
    }
  },
  async handle(interaction: Interaction, context: BootstrapContext): Promise<void> {
    if (!interaction.isButton() || !interaction.guild) {
      return;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId);
      if (parsed.namespace !== "alerts" || parsed.action !== "toggle-role") {
        return;
      }

      const [guildId, platform, roleId] = parsed.entityId.split("|");
      if (!guildId || !platform || !roleId || guildId !== interaction.guildId) {
        throw new ValidationError("This button does not belong to this server.");
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRole = member.roles.cache.has(roleId);

      if (hasRole) {
        await member.roles.remove(roleId);
      } else {
        await member.roles.add(roleId);
      }

      await interaction.reply({
        content: hasRole
          ? `${platform} alerts removed.`
          : `${platform} alerts enabled.`,
        ephemeral: true
      });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.safeMessage
          : "Refresh the post and try again.";

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
      context.logger.warn({ error, interactionId: interaction.id }, "Alert role interaction failed");
    }
  }
};
