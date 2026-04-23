import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  type ChatInputCommandInteraction
} from "discord.js";
import pkg from "@prisma/client";

import type { BootstrapContext } from "../../bootstrap/types.js";
import {
  addTournamentParticipantCommandSchema,
  configTournamentCommandSchema,
  createTournamentCommandSchema,
  joinTournamentCommandSchema,
  kickParticipantCommandSchema,
  manualAdvanceCommandSchema,
  renameParticipantCommandSchema,
  reseedCommandSchema,
  setPlayerBackCommandSchema,
  switchBracketNamesCommandSchema,
  tournamentIgnLookupCommandSchema,
  tournamentRulesCommandSchema
} from "../../validators/command-schemas.js";
import { buildSignedCustomId } from "../../interactions/secure-payload.js";
import { parseInput, replyWithError, resolveTournamentReference } from "./helpers.js";
import { ConflictError } from "../../utils/errors.js";

const { SeedingMethod, StaffRoleType, TournamentFormat } = pkg;

export const executeTourCommand = async (
  interaction: ChatInputCommandInteraction,
  context: BootstrapContext
): Promise<void> => {
  const ensureDeferredReply = async (): Promise<void> => {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
  };

  try {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }

    if (!(interaction.member instanceof GuildMember)) {
      await interaction.reply({ content: "This command requires a guild member context.", ephemeral: true });
      return;
    }

    const guildId = interaction.guildId;
    const member = interaction.member;
    const subcommand = interaction.options.getSubcommand(true);
    const tournamentReference = null;
    const tournamentId =
      subcommand === "create"
        ? null
        : await resolveTournamentReference(context, guildId, tournamentReference);
    const requireTournamentId = (): string => {
      if (!tournamentId) {
        throw new Error("Missing tournament context.");
      }

      return tournamentId;
    };
    switch (subcommand) {
      case "create": {
        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.create");
        const channel = interaction.options.getChannel("channel", true);
        const parsed = parseInput(createTournamentCommandSchema, {
          name: "V2 1v1 Viewer Tournament",
          announcementChannelId: channel.id,
          format: TournamentFormat.SINGLE_ELIMINATION,
          maxParticipants: 256,
          bestOfDefault: 3
        });
        await context.adminTournamentService.createTournament({
          guildId,
          actorUserId: interaction.user.id,
          name: parsed.name ?? "V2 1v1 Viewer Tournament",
          announcementChannelId: parsed.announcementChannelId,
          format: parsed.format ?? TournamentFormat.SINGLE_ELIMINATION,
          maxParticipants: parsed.maxParticipants ?? 256,
          bestOfDefault: parsed.bestOfDefault ?? 3
        });
        await interaction.reply({
          content: `Tournament created in <#${parsed.announcementChannelId}>.`,
          ephemeral: true
        });
        return;
      }

      case "config": {
        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.config");
        const parsed = parseInput(configTournamentCommandSchema, {
          tournamentId,
          seedingMethod: (interaction.options.getString("seeding") as SeedingMethod | null) ?? undefined,
          mutualExclusionKey: interaction.options.getString("mutual_exclusion_key"),
          requireOpponentConfirmation: interaction.options.getBoolean("require_opponent_confirmation") ?? undefined,
          grandFinalResetEnabled: interaction.options.getBoolean("grand_finals_reset") ?? undefined,
          allowWithdrawals: interaction.options.getBoolean("allow_withdrawals") ?? undefined
        });
        await context.adminTournamentService.configureTournament({
          guildId,
          tournamentId: parsed.tournamentId,
          actorUserId: interaction.user.id,
          seedingMethod: parsed.seedingMethod,
          mutualExclusionKey: parsed.mutualExclusionKey,
          requireOpponentConfirmation: parsed.requireOpponentConfirmation,
          grandFinalResetEnabled: parsed.grandFinalResetEnabled,
          allowWithdrawals: parsed.allowWithdrawals
        });
        await interaction.reply({ content: "Tournament configuration updated.", ephemeral: true });
        return;
      }

      case "open":
      case "start":
      case "unstart":
      case "finish":
      case "cancel":
      {
        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, `command.tour.${subcommand}`);
        if (subcommand === "open") {
          await context.adminTournamentService.openTournament({ guildId, tournamentId: requireTournamentId(), actorUserId: interaction.user.id });
          await interaction.reply({ content: "Registration is open.", ephemeral: true });
          return;
        }
        if (subcommand === "start") {
          await ensureDeferredReply();
          await context.adminTournamentService.startTournament({ guildId, tournamentId: requireTournamentId(), actorUserId: interaction.user.id });
          await interaction.editReply({ content: "Tournament started." });
          return;
        }
        if (subcommand === "unstart") {
          await ensureDeferredReply();
          await context.adminTournamentService.rollbackTournamentStart({
            guildId,
            tournamentId: requireTournamentId(),
            actorUserId: interaction.user.id
          });
          await interaction.editReply({ content: "Registration is open again." });
          return;
        }
        if (subcommand === "finish") {
          await ensureDeferredReply();
          await context.adminTournamentService.finalizeTournament({ guildId, tournamentId: requireTournamentId(), actorUserId: interaction.user.id });
          await interaction.editReply({ content: "Tournament finished." });
          return;
        }
        await ensureDeferredReply();
        await context.adminTournamentService.cancelTournament({
          guildId,
          tournamentId: requireTournamentId(),
          actorUserId: interaction.user.id,
          reason: "Cancelled by staff"
        });
        await interaction.editReply({ content: "Tournament cancelled." });
        return;
      }

      case "rules": {
        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.rules");
        const parsed = parseInput(tournamentRulesCommandSchema, {
          tournamentId,
          section: interaction.options.getString("section", true),
          mode: interaction.options.getString("action", true),
          value: interaction.options.getString("value") ?? undefined
        });
        await context.adminTournamentService.updateTournamentRules({
          guildId,
          tournamentId: parsed.tournamentId,
          actorUserId: interaction.user.id,
          section: parsed.section,
          mode: parsed.mode,
          value: parsed.value
        });
        await interaction.reply({ content: "Rules updated.", ephemeral: true });
        return;
      }

      case "join":
      case "add":
      case "ign":
      case "addfake":
      case "leave": {
        if (subcommand === "addfake") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.addfake");
          await ensureDeferredReply();
          const result = await context.registrationService.addFakePlayers({
            guildId,
            tournamentId: requireTournamentId(),
            actorUserId: interaction.user.id,
            count: interaction.options.getInteger("count", true),
            prefix: interaction.options.getString("prefix") ?? undefined
          });
          await interaction.editReply({
            content: `Added ${result.addedCount} fake player${result.addedCount === 1 ? "" : "s"}.`
          });
          return;
        }

        if (subcommand === "add") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.add");
          const targetUser = interaction.options.getUser("user", true);
          const parsed = parseInput(addTournamentParticipantCommandSchema, {
            tournamentId,
            targetUserId: targetUser.id,
            name: interaction.options.getString("name", true),
            leagueIgn: interaction.options.getString("league_ign", true)
          });
          const result = await context.registrationService.addParticipantByStaff({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            targetUserId: parsed.targetUserId,
            displayName: parsed.name,
            opggProfile: parsed.leagueIgn
          });
          await interaction.reply({
            content: result.waitlisted
              ? `Added to the waitlist at position ${result.waitlistPosition}.`
              : "Player added.",
            ephemeral: true
          });
          return;
        }

        if (subcommand === "ign") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.ign");
          const parsed = parseInput(tournamentIgnLookupCommandSchema, {
            tournamentId,
            name: interaction.options.getString("name", true)
          });
          const result = await context.viewingService.getIgnLookup(
            guildId,
            parsed.tournamentId,
            parsed.name
          );
          await interaction.reply({
            content: [
              `Name: ${result.displayName}`,
              `IGN: ${result.leagueIgn ?? "Not set"}`,
              `Bracket: ${result.locationLabel ?? "Not set"}`
            ].join("\n"),
            ephemeral: true
          });
          return;
        }

        if (subcommand === "join") {
          const parsed = parseInput(joinTournamentCommandSchema, {
            tournamentId,
            name: interaction.options.getString("name", true),
            leagueIgn: interaction.options.getString("league_ign", true)
          });
          const result = await context.registrationService.joinTournament({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            displayName: parsed.name,
            opggProfile: parsed.leagueIgn
          });
          await interaction.reply({
            content: result.waitlisted
              ? `Added to the waitlist at position ${result.waitlistPosition}.`
              : "You're in.",
            ephemeral: true
          });
          return;
        }
        try {
          const result = await context.registrationService.leaveTournament({
            guildId,
            tournamentId: requireTournamentId(),
            actorUserId: interaction.user.id
          });
          await interaction.reply({
            content: result.leftWaitlist ? "Removed from the waitlist." : "You left the tournament.",
            ephemeral: true
          });
          return;
        } catch (error) {
          if (
            error instanceof ConflictError &&
            error.message === "You can only leave while registration is open."
          ) {
            await ensureDeferredReply();
            const result = await context.matchReportingService.kickParticipantBySelection({
              guildId,
              tournamentId: requireTournamentId(),
              actorUserId: interaction.user.id,
              targetUserId: interaction.user.id
            });
            await interaction.editReply({
              content: result.advancedOpponentName
                ? `You left the tournament. ${result.advancedOpponentName} advances.`
                : "You left the tournament."
            });
            return;
          }

          throw error;
        }
      }

      case "advance":
      case "back":
      case "kick":
      case "undo":
      case "rename":
      case "switch":
      case "reseed": {
        if (subcommand === "advance") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.MODERATOR, "command.tour.advance");
          const parsed = parseInput(manualAdvanceCommandSchema, {
            tournamentId,
            targetPlayerName: interaction.options.getString("name", true)
          });
          await ensureDeferredReply();
          const result = await context.matchReportingService.manualAdvanceBySelection({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            targetPlayerName: parsed.targetPlayerName,
            idempotencyKey: interaction.id
          });
          await interaction.editReply({
            content: result.finalized
              ? `Advanced. Winner: ${result.championRegistrationId}.`
              : "Advanced.",
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    buildSignedCustomId(
                      "staff",
                      "undo-advance",
                      `${parsed.tournamentId}|${result.reportId}|${interaction.user.id}`,
                      `undo-${result.reportId}`
                    )
                  )
                  .setLabel("Undo Advance")
                  .setStyle(ButtonStyle.Secondary)
              )
            ]
          });
          return;
        }

        if (subcommand === "back") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.MODERATOR, "command.tour.back");
          const parsed = parseInput(setPlayerBackCommandSchema, {
            tournamentId,
            targetPlayerName: interaction.options.getString("name", true)
          });
          await ensureDeferredReply();
          const result = await context.matchReportingService.setPlayerBackBySelection({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            targetPlayerName: parsed.targetPlayerName
          });
          await interaction.editReply({
            content: `Moved ${result.targetPlayerName} back one match.`
          });
          return;
        }

        if (subcommand === "kick") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.kick");
          const parsed = parseInput(kickParticipantCommandSchema, {
            tournamentId,
            targetPlayerName: interaction.options.getString("name", true)
          });
          await ensureDeferredReply();
          const result = await context.matchReportingService.kickParticipantBySelection({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            targetPlayerName: parsed.targetPlayerName
          });
          await interaction.editReply({
            content: result.advancedOpponentName
              ? `Removed ${result.targetPlayerName}. ${result.advancedOpponentName} advances.`
              : `Removed ${result.targetPlayerName}.`
          });
          return;
        }

        if (subcommand === "undo") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.MODERATOR, "command.tour.undo");
          await ensureDeferredReply();
          const result = await context.matchReportingService.undoLatestManualAdvance({
            guildId,
            tournamentId: requireTournamentId(),
            actorUserId: interaction.user.id
          });
          await interaction.editReply({
            content: `Undid advance ${result.reportId}.`
          });
          return;
        }

        if (subcommand === "rename") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.rename");
          const parsed = parseInput(renameParticipantCommandSchema, {
            tournamentId,
            currentPlayerName: interaction.options.getString("name", true),
            nextPlayerName: interaction.options.getString("new_name", true)
          });
          await context.adminTournamentService.renameParticipant({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            currentPlayerName: parsed.currentPlayerName,
            nextPlayerName: parsed.nextPlayerName
          });
          await interaction.reply({
            content: `Renamed ${parsed.currentPlayerName} to ${parsed.nextPlayerName}.`,
            ephemeral: true
          });
          return;
        }

        if (subcommand === "switch") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.switch");
          const parsed = parseInput(switchBracketNamesCommandSchema, {
            tournamentId,
            firstPlayerName: interaction.options.getString("name_one", true),
            secondPlayerName: interaction.options.getString("name_two", true)
          });
          await context.adminTournamentService.switchBracketNames({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            firstPlayerName: parsed.firstPlayerName,
            secondPlayerName: parsed.secondPlayerName
          });
          await interaction.reply({
            content: `Switched ${parsed.firstPlayerName} and ${parsed.secondPlayerName}.`,
            ephemeral: true
          });
          return;
        }

        if (subcommand === "reseed") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.reseed");
          const parsed = parseInput(reseedCommandSchema, {
            tournamentId,
            method: interaction.options.getString("method", true) as SeedingMethod
          });
          await context.adminTournamentService.reseedTournament({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            method: parsed.method,
            reason: "Reseeded by staff"
          });
          await interaction.reply({ content: "Seeds updated.", ephemeral: true });
          return;
        }

        return;
      }

      default:
        await interaction.reply({ content: "That command isn't available.", ephemeral: true });
    }
  } catch (error) {
    await replyWithError(interaction, error);
  }
};
