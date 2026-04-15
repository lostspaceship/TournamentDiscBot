import { MatchOutcomeType } from "@prisma/client";

import type { TournamentCommandContext } from "../helpers.js";
import { parseInput } from "../helpers.js";
import {
  confirmResultCommandSchema,
  disputeResultCommandSchema,
  matchReportCommandSchema,
  matchViewCommandSchema
} from "../../../validators/command-schemas.js";
import { buildMatchDetailEmbed } from "../../../utils/tournament-view-ui.js";

export const handleMatchGroup = async (
  command: TournamentCommandContext
): Promise<boolean> => {
  const { interaction, context, guildId } = command;

  if (interaction.options.getSubcommandGroup(false) !== "match") {
    return false;
  }

  const subcommand = interaction.options.getSubcommand(true);

  switch (subcommand) {
    case "view": {
      const parsed = parseInput(matchViewCommandSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        matchId: interaction.options.getString("match_id") ?? undefined
      });

      if (parsed.matchId) {
        const view = await context.viewingService.getMatchDetail(
          guildId,
          parsed.tournamentId,
          parsed.matchId
        );

        await interaction.reply({
          embeds: [buildMatchDetailEmbed(view)]
        });
        return true;
      }

      const currentMatch = await context.matchReportingService.getMatchView({
        guildId,
        tournamentId: parsed.tournamentId,
        actorUserId: interaction.user.id
      });

      const detail = await context.viewingService.getMatchDetail(
        guildId,
        parsed.tournamentId,
        currentMatch.matchId
      );

      await interaction.reply({
        embeds: [buildMatchDetailEmbed(detail)],
        ephemeral: true
      });
      return true;
    }

    case "report": {
      const parsed = parseInput(matchReportCommandSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        matchId: interaction.options.getString("match_id", true),
        winnerRegistrationId: interaction.options.getString("winner_id", true),
        loserRegistrationId: interaction.options.getString("loser_id", true),
        outcomeType: interaction.options.getString("outcome", true) as MatchOutcomeType,
        winnerScore: interaction.options.getInteger("winner_score"),
        loserScore: interaction.options.getInteger("loser_score"),
        reason: interaction.options.getString("reason")
      });

      const result = await context.matchReportingService.reportResult({
        guildId,
        tournamentId: parsed.tournamentId,
        actorUserId: interaction.user.id,
        matchId: parsed.matchId,
        winnerRegistrationId: parsed.winnerRegistrationId,
        loserRegistrationId: parsed.loserRegistrationId,
        outcomeType: parsed.outcomeType,
        winnerScore: parsed.winnerScore,
        loserScore: parsed.loserScore,
        reason: parsed.reason,
        idempotencyKey: interaction.id
      });

      await interaction.reply({
        content: `Result report ${result.reportId} recorded. Opponent confirmation is now required.`,
        ephemeral: true
      });
      return true;
    }

    case "confirm": {
      const parsed = parseInput(confirmResultCommandSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        reportId: interaction.options.getString("report_id", true)
      });

      const result = await context.matchReportingService.confirmResult({
        guildId,
        tournamentId: parsed.tournamentId,
        actorUserId: interaction.user.id,
        reportId: parsed.reportId
      });

      await interaction.reply({
        content: result.finalized
          ? `Result confirmed and bracket advanced. Tournament finalized with champion ${result.championRegistrationId}.`
          : "Result confirmed and bracket advanced successfully.",
        ephemeral: true
      });
      return true;
    }

    case "dispute": {
      const parsed = parseInput(disputeResultCommandSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        reportId: interaction.options.getString("report_id", true),
        reason: interaction.options.getString("reason", true)
      });

      await context.matchReportingService.disputeResult({
        guildId,
        tournamentId: parsed.tournamentId,
        actorUserId: interaction.user.id,
        reportId: parsed.reportId,
        reason: parsed.reason
      });

      await interaction.reply({
        content: "Result report disputed. Staff review or a new report is now required.",
        ephemeral: true
      });
      return true;
    }

    default:
      return false;
  }
};
