import { GuildMember, type ChatInputCommandInteraction } from "discord.js";
import { BracketType, MatchOutcomeType, SeedingMethod, StaffRoleType, TournamentFormat } from "@prisma/client";

import type { BootstrapContext } from "../../bootstrap/types.js";
import {
  buildBracketRoundComponents,
  buildBracketRoundEmbed,
  buildMatchDetailEmbed,
  buildOverviewEmbed,
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
  manualAdvanceCommandSchema,
  matchReportCommandSchema,
  matchViewCommandSchema,
  moderationCommandSchema,
  reseedCommandSchema,
  reasonedTournamentActionSchema,
  tournamentIdSchema
} from "../../validators/command-schemas.js";
import { parseInput, replyWithError } from "../tournament/helpers.js";

export const executeTourCommand = async (
  interaction: ChatInputCommandInteraction,
  context: BootstrapContext
): Promise<void> => {
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
    const tournamentId = interaction.options.getString("tournament_id");
    const displayName = member.displayName ?? interaction.user.username;

    switch (subcommand) {
      case "create": {
        await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, "command.tour.create");
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
        await interaction.reply({ content: `Tournament created: ${created.name} (${created.id})`, ephemeral: true });
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
              `Max participants: ${tournament.maxParticipants}`,
              `Best of: ${tournament.bestOfDefault}`,
              `Require check-in: ${tournament.requireCheckIn ? "yes" : "no"}`,
              `Waitlist: ${tournament.allowWaitlist ? "enabled" : "disabled"}`,
              `Seeding: ${tournament.settings?.seedingMethod ?? "RANDOM"}`,
              `Opponent confirm: ${tournament.settings?.requireOpponentConfirmation ? "yes" : "no"}`
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
        if (subcommand === "close") {
          await context.adminTournamentService.closeTournament({ guildId, tournamentId, actorUserId: interaction.user.id });
          await interaction.reply({ content: "Registration closed.", ephemeral: true });
          return;
        }
        if (subcommand === "start") {
          await context.adminTournamentService.startTournament({ guildId, tournamentId, actorUserId: interaction.user.id });
          await interaction.reply({ content: "Tournament started and the bracket is now locked.", ephemeral: true });
          return;
        }
        if (subcommand === "finish") {
          await context.adminTournamentService.finalizeTournament({ guildId, tournamentId, actorUserId: interaction.user.id });
          await interaction.reply({ content: "Tournament finalized successfully.", ephemeral: true });
          return;
        }
        const parsed = parseInput(reasonedTournamentActionSchema, {
          tournamentId,
          reason: interaction.options.getString("reason", true)
        });
        await context.adminTournamentService.cancelTournament({
          guildId,
          tournamentId: parsed.tournamentId,
          actorUserId: interaction.user.id,
          reason: parsed.reason
        });
        await interaction.reply({ content: "Tournament cancelled successfully.", ephemeral: true });
        return;
      }

      case "join":
      case "leave":
      case "checkin": {
        const parsed = parseInput(tournamentIdSchema, { tournamentId });
        if (subcommand === "join") {
          const result = await context.registrationService.joinTournament({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            displayName
          });
          await interaction.reply({
            content: result.waitlisted
              ? `Tournament is full. You were added to the waitlist at position ${result.waitlistPosition}.`
              : "You have successfully joined the tournament.",
            ephemeral: true
          });
          return;
        }
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
        const embeds = [buildOverviewEmbed(overview)];
        try {
          const roundView = await context.viewingService.getBracketRound(guildId, parsed.tournamentId);
          embeds.push(buildBracketRoundEmbed(roundView));
          await interaction.reply({
            embeds,
            components: buildBracketRoundComponents(roundView)
          });
        } catch {
          await interaction.reply({ embeds });
        }
        return;
      }

      case "participants": {
        const parsed = parseInput(tournamentIdSchema, { tournamentId });
        const view = await context.viewingService.getParticipantsPage(guildId, parsed.tournamentId, 1);
        await interaction.reply({
          embeds: [buildParticipantsEmbed(view, "Participants")],
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

        if (subcommand === "advance") {
          await context.permissionService.requireMinimumRole(guildId, member, StaffRoleType.MODERATOR, "command.tour.advance");
          const parsed = parseInput(manualAdvanceCommandSchema, {
            tournamentId,
            matchId: interaction.options.getString("match_id", true),
            winnerRegistrationId: interaction.options.getString("winner_id", true),
            reason: interaction.options.getString("reason", true)
          });
          const result = await context.matchReportingService.manualAdvance({
            guildId,
            tournamentId: parsed.tournamentId,
            actorUserId: interaction.user.id,
            matchId: parsed.matchId,
            winnerRegistrationId: parsed.winnerRegistrationId,
            reason: parsed.reason,
            idempotencyKey: interaction.id
          });
          await interaction.reply({
            content: result.finalized
              ? `Manual advance applied. Tournament finalized with champion ${result.championRegistrationId}.`
              : "Manual advance applied and bracket updated.",
            ephemeral: true
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
