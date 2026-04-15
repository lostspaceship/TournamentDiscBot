import { GuildMember, type ChatInputCommandInteraction } from "discord.js";

import type { BootstrapContext } from "../../bootstrap/types.js";
import { handleBracketGroup } from "./handlers/bracket.js";
import { handleLifecycleGroup } from "./handlers/lifecycle.js";
import { handleMatchGroup } from "./handlers/match.js";
import { handleRegistrationGroup } from "./handlers/registration.js";
import { handleStaffGroup } from "./handlers/staff.js";
import { replyWithError, type TournamentCommandContext } from "./helpers.js";

const groupHandlers = [
  handleRegistrationGroup,
  handleMatchGroup,
  handleBracketGroup,
  handleLifecycleGroup,
  handleStaffGroup
] as const;

export const executeTournamentCommand = async (
  interaction: ChatInputCommandInteraction,
  context: BootstrapContext
): Promise<void> => {
  try {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true
      });
      return;
    }

    if (!(interaction.member instanceof GuildMember)) {
      await interaction.reply({
        content: "This command requires a full guild member context.",
        ephemeral: true
      });
      return;
    }

    const commandContext: TournamentCommandContext = {
      interaction,
      context,
      guildId: interaction.guildId,
      member: interaction.member
    };

    for (const handler of groupHandlers) {
      if (await handler(commandContext)) {
        return;
      }
    }

    await interaction.reply({
      content: "This command is registered, but execution has not been wired yet.",
      ephemeral: true
    });
  } catch (error) {
    await replyWithError(interaction, error);
  }
};
