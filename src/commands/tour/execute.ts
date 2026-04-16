import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  type ChatInputCommandInteraction
} from "discord.js";
import { BracketType, MatchOutcomeType, SeedingMethod, StaffRoleType, TournamentFormat } from "@prisma/client";

import type { BootstrapContext } from "../../bootstrap/types.js";
import {
  buildBracketRoundComponents,
  buildBracketRoundEmbed,
  buildMatchDetailEmbed,
  buildOverviewEmbed,
  buildOverviewWithParticipantsComponents,
  buildParticipantsComponents,
  buildParticipantsEmbed,
  buildStaffPanelComponents,
  buildStaffPanelEmbed
} from "../../utils/tournament-view-ui.js";
import { ValidationError } from "../../utils/errors.js";
import {
  bracketRoundCommandSchema,
  configTournamentCommandSchema,
  confirmResultCommandSchema,
  createTournamentCommandSchema,
  disputeResultCommandSchema,
  fakePlayersCommandSchema,
  joinTournamentCommandSchema,
  manualAdvanceCommandSchema,
  matchReportCommandSchema,
  matchViewCommandSchema,
  moderationCommandSchema,
  reseedCommandSchema,
  reasonedTournamentActionSchema,
  tournamentIdSchema
} from "../../validators/command-schemas.js";
import { buildSignedCustomId } from "../../interactions/secure-payload.js";
import { parseInput, replyWithError, resolveTournamentReference } from "../tournament/helpers.js";

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
    const tournamentReference = interaction.options.getString("tournament_id");
    const tournamentId =
      subcommand === "create"
        ? null
        : await resolveTournamentReference(context, guildId, tournamentReference);
    switch (subcommand) {
      case "create": {
        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.create");
        const channel = interaction.options.getChannel("channel", true);
        const parsed = parseInput(createTournamentCommandSchema, {
          name: interaction.options.getString("name") ?? "V2 1v1 Viewer Tournament",
          announcementChannelId: channel.id,
          format: TournamentFormat.SINGLE_ELIMINATION,
          maxParticipants: 256,
          bestOfDefault: 3
        });
        const created = await context.adminTournamentService.createTournament({
          guildId,
          actorUserId: interaction.user.id,
          name: parsed.name ?? "V2 1v1 Viewer Tournament",
          announcementChannelId: parsed.announcementChannelId,
          format: parsed.format ?? TournamentFormat.SINGLE_ELIMINATION,
          maxParticipants: parsed.maxParticipants ?? 256,
          bestOfDefault: parsed.bestOfDefault ?? 3
        });
        await interaction.reply({
          content: `Tournament created: ${created.name}. Public updates are now tracked in <#${parsed.announcementChannelId}>. Use \`${created.slug}\` in commands.`,
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
      case "close":
      case "start":
      case "finish":
      case "cancel":
      case "settings": {
        if (!tournamentId) {
          throw new ValidationError("Tournament ID is required.");
        }
        if (subcommand === "settings") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.settings");
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
              `Best of: ${tournament.bestOfDefault}`,
              `Channel: ${tournament.infoMessageChannelId ? `<#${tournament.infoMessageChannelId}>` : "Not set"}`,
              `Seeding: ${tournament.settings?.seedingMethod ?? "RANDOM"}`
            ].join("\n"),
            ephemeral: true
          });
          return;
        }

        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, `command.tour.${subcommand}`);
        if (subcommand === "open") {
          await context.adminTournamentService.openTournament({ guildId, tournamentId, actorUserId: interaction.user.id });
          await interaction.reply({ content: "Registration opened.", ephemeral: true });
          return;
        }
        if (subcommand === "start") {
          await ensureDeferredReply();
          await context.adminTournamentService.startTournament({ guildId, tournamentId, actorUserId: interaction.user.id });
          await interaction.editReply({ content: "Tournament started and the bracket is now locked." });
          return;
        }
        if (subcommand === "close") {
          await ensureDeferredReply();
          await context.adminTournamentService.startTournament({ guildId, tournamentId, actorUserId: interaction.user.id });
          await interaction.editReply({
            content: "Registration closed, the bracket is locked, and the tournament is ready for advances.",
          });
          return;
        }
        if (subcommand === "finish") {
          await ensureDeferredReply();
          await context.adminTournamentService.finalizeTournament({ guildId, tournamentId, actorUserId: interaction.user.id });
          await interaction.editReply({ content: "Tournament finalized successfully." });
          return;
        }
        const parsed = parseInput(reasonedTournamentActionSchema, {
          tournamentId,
          reason: interaction.options.getString("reason", true)
        });
        await ensureDeferredReply();
        await context.adminTournamentService.cancelTournament({
          guildId,
          tournamentId: parsed.tournamentId,
          actorUserId: interaction.user.id,
          reason: parsed.reason
        });
        await interaction.editReply({ content: "Tournament cancelled successfully." });
        return;
      }

      case "join":
      case "leave":
      case "checkin": {
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
              ? `Tournament is full. You were added to the waitlist at position ${result.waitlistPosition}.`
              : "You have successfully joined the tournament.",
            ephemeral: true
          });
          return;
        }
        const parsed = parseInput(tournamentIdSchema, { tournamentId });
        if (subcommand === "leave") {
          const result = await context.registrationService.leaveTournament({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id
          });
          await interaction.reply({
            content: result.leftWaitlist ? "You were removed from the waitlist." : "You have successfully left the tournament.",
            ephemeral: true
          });
          return;
        }
        await context.registrationService.checkIn({
          guildId,
          tournamentId: parsed.tournamentId,
          actorUserId: interaction.user.id
        });
        await interaction.reply({ content: "Check-in recorded successfully.", ephemeral: true });
        return;
      }

      case "view": {
        const parsed = parseInput(tournamentIdSchema, { tournamentId });
        const overview = await context.viewingService.getOverview(guildId, parsed.tournamentId);
        const participants = await context.viewingService.getParticipantsPage(
          guildId,
          parsed.tournamentId,
          1
        );
        await interaction.reply({
          embeds: [buildOverviewEmbed(overview), buildParticipantsEmbed(participants, "Registered Players", false)],
          components: buildOverviewWithParticipantsComponents(
            participants.tournamentId,
            participants.page,
            participants.totalPages
          )
        });
        return;
      }

      case "participants": {
        const parsed = parseInput(tournamentIdSchema, { tournamentId });
        const view = await context.viewingService.getParticipantsPage(guildId, parsed.tournamentId, 1);
        await interaction.reply({
          embeds: [buildParticipantsEmbed(view, "Registered Players", false)],
          components: buildParticipantsComponents(view.tournamentId, view.page, view.totalPages, "participants")
        });
        return;
      }

      case "bracket": {
        const parsed = parseInput(tournamentIdSchema, { tournamentId });
        const side = interaction.options.getString("side") as BracketType | null;
        const roundNumber = interaction.options.getInteger("round_number") ?? undefined;
        if (side && roundNumber != null) {
          parseInput(bracketRoundCommandSchema, { tournamentId: parsed.tournamentId, side, roundNumber });
        }
        const roundView = await context.viewingService.getBracketRound(
          guildId,
          parsed.tournamentId,
          side ?? undefined,
          roundNumber
        );
        await interaction.reply({
          embeds: [buildBracketRoundEmbed(roundView)],
          components: buildBracketRoundComponents(roundView)
        });
        return;
      }

      case "match": {
        const parsed = parseInput(matchViewCommandSchema, {
          tournamentId,
          matchId: interaction.options.getString("match_id") ?? undefined
        });
        if (parsed.matchId) {
          const view = await context.viewingService.getMatchDetail(guildId, parsed.tournamentId, parsed.matchId);
          await interaction.reply({ embeds: [buildMatchDetailEmbed(view)] });
          return;
        }
        const currentMatch = await context.matchReportingService.getMatchView({
          guildId,
          tournamentId: parsed.tournamentId,
          actorUserId: interaction.user.id
        });
        const detail = await context.viewingService.getMatchDetail(guildId, parsed.tournamentId, currentMatch.matchId);
        await interaction.reply({ embeds: [buildMatchDetailEmbed(detail)], ephemeral: true });
        return;
      }

      case "report": {
        const parsed = parseInput(matchReportCommandSchema, {
          tournamentId,
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
        await interaction.reply({ content: `Result report ${result.reportId} recorded. Opponent confirmation is now required.`, ephemeral: true });
        return;
      }

      case "confirm": {
        const parsed = parseInput(confirmResultCommandSchema, {
          tournamentId,
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
        return;
      }

      case "dispute": {
        const parsed = parseInput(disputeResultCommandSchema, {
          tournamentId,
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
        await interaction.reply({ content: "Result report disputed. Staff review or a new report is now required.", ephemeral: true });
        return;
      }

      case "addfake":
      case "advance":
      case "dq":
      case "drop":
      case "reseed":
      case "staff": {
        if (!tournamentId) {
          throw new ValidationError("Tournament ID is required.");
        }
        if (subcommand === "staff") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.staff");
          const view = await context.viewingService.getStaffPanel(guildId, tournamentId, StaffRoleType.TOURNAMENT_STAFF);
          await interaction.reply({
            embeds: [buildStaffPanelEmbed(view, "overview")],
            components: buildStaffPanelComponents(tournamentId, interaction.user.id, "overview"),
            ephemeral: true
          });
          return;
        }

        if (subcommand === "addfake") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.addfake");
          const parsed = parseInput(fakePlayersCommandSchema, {
            tournamentId,
            count: interaction.options.getInteger("count", true),
            prefix: interaction.options.getString("prefix") ?? undefined
          });
          await ensureDeferredReply();
          const result = await context.registrationService.addFakePlayers({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            count: parsed.count,
            prefix: parsed.prefix
          });
          await interaction.editReply({
            content:
              result.addedCount <= 6
                ? `Added ${result.addedCount} fake player${result.addedCount === 1 ? "" : "s"}: ${result.names.join(", ")}.`
                : `Added ${result.addedCount} fake players. First few: ${result.names.slice(0, 6).join(", ")}.`
          });
          return;
        }

        if (subcommand === "advance") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.MODERATOR, "command.tour.advance");
          const parsed = parseInput(manualAdvanceCommandSchema, {
            tournamentId,
            targetUserId: interaction.options.getUser("user")?.id,
            targetPlayerName: interaction.options.getString("name") ?? undefined
          });
          await ensureDeferredReply();
          const result = await context.matchReportingService.manualAdvanceBySelection({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            targetUserId: parsed.targetUserId,
            targetPlayerName: parsed.targetPlayerName,
            idempotencyKey: interaction.id
          });
          await interaction.editReply({
            content: result.finalized
              ? `Manual advance applied. Tournament finalized with champion ${result.championRegistrationId}.`
              : "Manual advance applied and bracket updated.",
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

        if (subcommand === "reseed") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.reseed");
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
          await interaction.reply({ content: "Tournament seeds updated successfully.", ephemeral: true });
          return;
        }

        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.MODERATOR, `command.tour.${subcommand}`);
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
          await interaction.reply({ content: `Participant ${target.tag} was disqualified.`, ephemeral: true });
          return;
        }
        await context.adminTournamentService.dropParticipant({
          guildId,
          tournamentId: parsed.tournamentId,
          actorUserId: interaction.user.id,
          targetUserId: parsed.targetUserId,
          reason: parsed.reason
        });
        await interaction.reply({ content: `Participant ${target.tag} was dropped from the tournament.`, ephemeral: true });
        return;
      }

      default:
        await interaction.reply({ content: "This command is not wired yet.", ephemeral: true });
    }
  } catch (error) {
    await replyWithError(interaction, error);
  }
};
