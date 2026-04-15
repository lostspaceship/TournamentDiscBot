import { BracketType } from "@prisma/client";

import type { TournamentCommandContext } from "../helpers.js";
import { parseInput } from "../helpers.js";
import {
  bracketRoundCommandSchema,
  matchViewCommandSchema,
  tournamentIdSchema
} from "../../../validators/command-schemas.js";
import {
  buildBracketRoundComponents,
  buildBracketRoundEmbed,
  buildMatchDetailEmbed,
  buildOverviewEmbed
} from "../../../utils/tournament-view-ui.js";

export const handleBracketGroup = async (
  command: TournamentCommandContext
): Promise<boolean> => {
  const { interaction, context, guildId } = command;

  if (interaction.options.getSubcommandGroup(false) !== "bracket") {
    return false;
  }

  const subcommand = interaction.options.getSubcommand(true);

  switch (subcommand) {
    case "view": {
      const { tournamentId } = parseInput(tournamentIdSchema, {
        tournamentId: interaction.options.getString("tournament_id", true)
      });

      const overview = await context.viewingService.getOverview(guildId, tournamentId);
      try {
        const roundView = await context.viewingService.getBracketRound(guildId, tournamentId);

        await interaction.reply({
          embeds: [buildOverviewEmbed(overview), buildBracketRoundEmbed(roundView)],
          components: buildBracketRoundComponents(roundView)
        });
      } catch {
        await interaction.reply({
          embeds: [buildOverviewEmbed(overview)]
        });
      }
      return true;
    }

    case "round": {
      const parsed = parseInput(bracketRoundCommandSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        side: interaction.options.getString("side", true) as BracketType,
        roundNumber: interaction.options.getInteger("round_number", true)
      });

      const roundView = await context.viewingService.getBracketRound(
        guildId,
        parsed.tournamentId,
        parsed.side,
        parsed.roundNumber
      );

      await interaction.reply({
        embeds: [buildBracketRoundEmbed(roundView)],
        components: buildBracketRoundComponents(roundView)
      });
      return true;
    }

    case "match": {
      const parsed = parseInput(matchViewCommandSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        matchId: interaction.options.getString("match_id", true)
      });

      const view = await context.viewingService.getMatchDetail(
        guildId,
        parsed.tournamentId,
        parsed.matchId!
      );

      await interaction.reply({
        embeds: [buildMatchDetailEmbed(view)]
      });
      return true;
    }

    default:
      return false;
  }
};
