import { MatchOutcomeType, SeedingMethod, StaffRoleType } from "@prisma/client";

import type { TournamentCommandContext } from "../helpers.js";
import { parseInput } from "../helpers.js";
import {
  buildStaffPanelComponents,
  buildStaffPanelEmbed
} from "../../../utils/tournament-view-ui.js";
import {
  manualAdvanceCommandSchema,
  moderationCommandSchema,
  reseedCommandSchema,
  staffOverrideCommandSchema,
  tournamentIdSchema
} from "../../../validators/command-schemas.js";

export const handleStaffGroup = async (
  command: TournamentCommandContext
): Promise<boolean> => {
  const { interaction, context, guildId, member } = command;

  if (interaction.options.getSubcommandGroup(false) !== "staff") {
    return false;
  }

  const subcommand = interaction.options.getSubcommand(true);
  const tournamentId = interaction.options.getString("tournament_id", true);

  if (subcommand === "panel") {
    const parsed = parseInput(tournamentIdSchema, { tournamentId });
    await context.permissionService.requireMinimumRole(
      guildId,
      member,
      StaffRoleType.TOURNAMENT_STAFF,
      "command.staff.panel"
    );

    const view = await context.viewingService.getStaffPanel(
      guildId,
      parsed.tournamentId,
      StaffRoleType.TOURNAMENT_STAFF
    );

    await interaction.reply({
      embeds: [buildStaffPanelEmbed(view, "overview")],
      components: buildStaffPanelComponents(parsed.tournamentId, interaction.user.id, "overview"),
      ephemeral: true
    });
    return true;
  }

  if (subcommand === "dq" || subcommand === "drop") {
    await context.permissionService.requireMinimumRole(
      guildId,
      member,
      StaffRoleType.MODERATOR,
      `command.staff.${subcommand}`
    );

    const target = interaction.options.getUser("user", true);
    const parsed = parseInput(moderationCommandSchema, {
      tournamentId,
      targetUserId: target.id,
      reason: interaction.options.getString("reason", true)
    });

    if (subcommand === "dq") {
      await context.adminTournamentService.disqualifyParticipant({
        guildId,
        tournamentId: parsed.tournamentId,
        actorUserId: interaction.user.id,
        targetUserId: parsed.targetUserId,
        reason: parsed.reason
      });

      await interaction.reply({
        content: `Participant ${target.tag} was disqualified.`,
        ephemeral: true
      });
      return true;
    }

    await context.adminTournamentService.dropParticipant({
      guildId,
      tournamentId: parsed.tournamentId,
      actorUserId: interaction.user.id,
      targetUserId: parsed.targetUserId,
      reason: parsed.reason
    });

    await interaction.reply({
      content: `Participant ${target.tag} was dropped from the tournament.`,
      ephemeral: true
    });
    return true;
  }

  if (subcommand === "reseed") {
    await context.permissionService.requireMinimumRole(
      guildId,
      member,
      StaffRoleType.TOURNAMENT_STAFF,
      "command.staff.reseed"
    );

    const parsed = parseInput(reseedCommandSchema, {
      tournamentId,
      method: interaction.options.getString("method", true) as SeedingMethod,
      reason: interaction.options.getString("reason", true)
    });

    await context.adminTournamentService.reseedTournament({
      guildId,
      tournamentId: parsed.tournamentId,
      actorUserId: interaction.user.id,
      method: parsed.method,
      reason: parsed.reason
    });

    await interaction.reply({
      content: "Tournament seeds updated successfully.",
      ephemeral: true
    });
    return true;
  }

  if (subcommand === "advance") {
    await context.permissionService.requireMinimumRole(
      guildId,
      member,
      StaffRoleType.MODERATOR,
      "command.staff.advance"
    );

    const parsed = parseInput(manualAdvanceCommandSchema, {
      tournamentId,
      targetUserId: interaction.options.getUser("user")?.id,
      targetPlayerName: interaction.options.getString("name") ?? undefined
    });

    const result = await context.matchReportingService.manualAdvanceBySelection({
      guildId,
      tournamentId: parsed.tournamentId,
      actorUserId: interaction.user.id,
      targetUserId: parsed.targetUserId,
      targetPlayerName: parsed.targetPlayerName,
      idempotencyKey: interaction.id
    });

    await interaction.reply({
      content: result.finalized
        ? `Manual advance applied. Tournament finalized with champion ${result.championRegistrationId}.`
        : "Manual advance applied and bracket updated.",
      ephemeral: true
    });
    return true;
  }

  if (subcommand === "override") {
    await context.permissionService.requireMinimumRole(
      guildId,
      member,
      StaffRoleType.MODERATOR,
      "command.staff.override"
    );

    const parsed = parseInput(staffOverrideCommandSchema, {
      tournamentId,
      matchId: interaction.options.getString("match_id", true),
      winnerRegistrationId: interaction.options.getString("winner_id", true),
      loserRegistrationId: interaction.options.getString("loser_id", true),
      outcomeType: interaction.options.getString("outcome", true) as MatchOutcomeType,
      winnerScore: interaction.options.getInteger("winner_score"),
      loserScore: interaction.options.getInteger("loser_score"),
      reason: interaction.options.getString("reason", true)
    });

    const result = await context.matchReportingService.overrideResult({
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
      content: result.finalized
        ? `Override applied. Match advanced and the tournament is now finalized with champion ${result.championRegistrationId}.`
        : "Override applied and bracket advanced successfully.",
      ephemeral: true
    });
    return true;
  }

  return false;
};
