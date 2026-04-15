import { SeedingMethod, StaffRoleType, TournamentFormat } from "@prisma/client";

import type { TournamentCommandContext } from "../helpers.js";
import { parseInput } from "../helpers.js";
import {
  configTournamentCommandSchema,
  createTournamentCommandSchema,
  reasonedTournamentActionSchema,
  tournamentIdSchema
} from "../../../validators/command-schemas.js";

export const handleLifecycleGroup = async (
  command: TournamentCommandContext
): Promise<boolean> => {
  const { interaction, context, guildId, member } = command;

  if (interaction.options.getSubcommandGroup(false) !== "lifecycle") {
    return false;
  }

  const subcommand = interaction.options.getSubcommand(true);
  await context.permissionService.requireMinimumRole(
    guildId,
    member,
    StaffRoleType.TOURNAMENT_STAFF,
    `command.lifecycle.${subcommand}`
  );

  switch (subcommand) {
    case "create": {
      const parsed = parseInput(createTournamentCommandSchema, {
        name: interaction.options.getString("name", true),
        description: interaction.options.getString("description"),
        format: interaction.options.getString("format", true) as TournamentFormat,
        maxParticipants: interaction.options.getInteger("max_participants", true),
        bestOfDefault: interaction.options.getInteger("best_of", true),
        requireCheckIn: interaction.options.getBoolean("require_checkin") ?? false,
        allowWaitlist: interaction.options.getBoolean("allow_waitlist") ?? true
      });

      const created = await context.adminTournamentService.createTournament({
        guildId,
        actorUserId: interaction.user.id,
        name: parsed.name,
        description: parsed.description,
        format: parsed.format,
        maxParticipants: parsed.maxParticipants,
        bestOfDefault: parsed.bestOfDefault,
        requireCheckIn: parsed.requireCheckIn,
        allowWaitlist: parsed.allowWaitlist
      });

      await interaction.reply({
        content: `Tournament created: ${created.name} (${created.id})`,
        ephemeral: true
      });
      return true;
    }

    case "config": {
      const parsed = parseInput(configTournamentCommandSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        seedingMethod:
          (interaction.options.getString("seeding") as SeedingMethod | null) ?? undefined,
        mutualExclusionKey: interaction.options.getString("mutual_exclusion_key"),
        requireOpponentConfirmation:
          interaction.options.getBoolean("require_opponent_confirmation") ?? undefined,
        grandFinalResetEnabled: interaction.options.getBoolean("grand_finals_reset") ?? undefined,
        allowWithdrawals: interaction.options.getBoolean("allow_withdrawals") ?? undefined
      });

      const updated = await context.adminTournamentService.configureTournament({
        guildId,
        tournamentId: parsed.tournamentId,
        actorUserId: interaction.user.id,
        seedingMethod: parsed.seedingMethod,
        mutualExclusionKey: parsed.mutualExclusionKey,
        requireOpponentConfirmation: parsed.requireOpponentConfirmation,
        grandFinalResetEnabled: parsed.grandFinalResetEnabled,
        allowWithdrawals: parsed.allowWithdrawals
      });

      await interaction.reply({
        content: `Tournament configuration updated for ${updated.name}.`,
        ephemeral: true
      });
      return true;
    }

    case "open": {
      const { tournamentId } = parseInput(tournamentIdSchema, {
        tournamentId: interaction.options.getString("tournament_id", true)
      });
      await context.adminTournamentService.openTournament({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id
      });
      await interaction.reply({ content: "Registration opened.", ephemeral: true });
      return true;
    }

    case "close": {
      const { tournamentId } = parseInput(tournamentIdSchema, {
        tournamentId: interaction.options.getString("tournament_id", true)
      });
      await context.adminTournamentService.closeTournament({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id
      });
      await interaction.reply({ content: "Registration closed.", ephemeral: true });
      return true;
    }

    case "start": {
      const { tournamentId } = parseInput(tournamentIdSchema, {
        tournamentId: interaction.options.getString("tournament_id", true)
      });
      await context.adminTournamentService.startTournament({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id
      });
      await interaction.reply({
        content: "Tournament started and bracket generated.",
        ephemeral: true
      });
      return true;
    }

    case "cancel": {
      const parsed = parseInput(reasonedTournamentActionSchema, {
        tournamentId: interaction.options.getString("tournament_id", true),
        reason: interaction.options.getString("reason", true)
      });
      await context.adminTournamentService.cancelTournament({
        guildId,
        tournamentId: parsed.tournamentId,
        actorUserId: interaction.user.id,
        reason: parsed.reason
      });
      await interaction.reply({
        content: "Tournament cancelled successfully.",
        ephemeral: true
      });
      return true;
    }

    case "finalize": {
      const { tournamentId } = parseInput(tournamentIdSchema, {
        tournamentId: interaction.options.getString("tournament_id", true)
      });
      await context.adminTournamentService.finalizeTournament({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id
      });
      await interaction.reply({
        content: "Tournament finalized successfully.",
        ephemeral: true
      });
      return true;
    }

    case "settings": {
      const { tournamentId } = parseInput(tournamentIdSchema, {
        tournamentId: interaction.options.getString("tournament_id", true)
      });
      const tournament = await context.adminTournamentService.getTournamentSettings({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id
      });

      await interaction.reply({
        content: [
          `Tournament: ${tournament.name}`,
          `Status: ${tournament.status}`,
          `Format: ${tournament.format}`,
          `Max participants: ${tournament.maxParticipants}`,
          `Best of: ${tournament.bestOfDefault}`,
          `Require check-in: ${tournament.requireCheckIn ? "yes" : "no"}`,
          `Waitlist: ${tournament.allowWaitlist ? "enabled" : "disabled"}`,
          `Seeding: ${tournament.settings?.seedingMethod ?? "RANDOM"}`,
          `Opponent confirm: ${tournament.settings?.requireOpponentConfirmation ? "yes" : "no"}`
        ].join("\n"),
        ephemeral: true
      });
      return true;
    }

    default:
      return false;
  }
};
