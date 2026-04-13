import type { ButtonInteraction, ChatInputCommandInteraction, GuildMember, Interaction } from "discord.js";

import { logger } from "../config/logger.js";
import type { BotContext } from "../types/bot.js";
import { errorReply, successReply } from "../utils/discord.js";
import { AppError } from "../utils/errors.js";
import { parseCustomId } from "./component-custom-id.js";

const ensureGuildMember = (interaction: ChatInputCommandInteraction | ButtonInteraction): GuildMember => {
  if (!interaction.guild || !interaction.member || interaction.member.user === undefined) {
    throw new Error("Guild member required.");
  }

  return interaction.member as GuildMember;
};

export const handleInteraction = async (interaction: Interaction, bot: BotContext) => {
  try {
    bot.interactionGuard.assertCooldown(interaction);

    if (interaction.isChatInputCommand()) {
      const command = bot.commands.get(interaction.commandName);
      if (!command) {
        await interaction.reply(errorReply("Unknown command."));
        return;
      }

      await command.execute(interaction, ensureGuildMember(interaction), bot);
      return;
    }

    if (interaction.isButton()) {
      const { namespace, action, entityId } = parseCustomId(interaction.customId);
      const [tournamentId, reportId] = entityId.split("|");
      if (namespace !== "result") {
        await interaction.reply(errorReply("Unknown action."));
        return;
      }

      if (action === "confirm") {
        await bot.tournamentService.confirmResult({
          guildId: interaction.guildId!,
          tournamentId: tournamentId ?? "",
          reportId: reportId ?? "",
          actorUserId: interaction.user.id
        });
        await interaction.reply(successReply("Result confirmed."));
        return;
      }

      if (action === "dispute") {
        await bot.tournamentService.disputeResult({
          guildId: interaction.guildId!,
          tournamentId: tournamentId ?? "",
          reportId: reportId ?? "",
          actorUserId: interaction.user.id
        });
        await interaction.reply(successReply("Result disputed. Staff review is now required."));
        return;
      }
    }
  } catch (error) {
    logger.error({ error }, "Interaction handling failed");
    const message = error instanceof AppError ? error.safeMessage : "An unexpected error occurred.";

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply(errorReply(message));
    }
  }
};
