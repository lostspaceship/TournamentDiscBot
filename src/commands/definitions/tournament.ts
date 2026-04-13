import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import {
  MatchOutcomeType,
  SeedingMethod,
  StaffRoleType,
  TournamentFormat
} from "@prisma/client";

import type { BootstrapContext, CommandModule } from "../../bootstrap/types.js";
import { AppError } from "../../utils/errors.js";

const tournamentIdOption = (description = "Tournament ID") => (option: any) =>
  option.setName("tournament_id").setDescription(description).setRequired(true);

const reasonOption = (description = "Reason for this action") => (option: any) =>
  option.setName("reason").setDescription(description).setRequired(true).setMaxLength(250);

const userOption = (description = "Target user") => (option: any) =>
  option.setName("user").setDescription(description).setRequired(true);

const boolOption = (name: string, description: string, required = false) => (option: any) =>
  option.setName(name).setDescription(description).setRequired(required);

const intOption = (
  name: string,
  description: string,
  minValue?: number,
  maxValue?: number,
  required = false
) => (option: any) => {
  option.setName(name).setDescription(description).setRequired(required);
  if (typeof minValue === "number") option.setMinValue(minValue);
  if (typeof maxValue === "number") option.setMaxValue(maxValue);
  return option;
};

const stringOption = (name: string, description: string, required = false) => (option: any) =>
  option.setName(name).setDescription(description).setRequired(required);

const outcomeChoices = [
  { name: "Score Report", value: "SCORE" },
  { name: "No Show", value: "NO_SHOW" },
  { name: "Disqualification", value: "DISQUALIFICATION" },
  { name: "Walkover", value: "WALKOVER" }
] as const;

const tournamentCommandBuilder = new SlashCommandBuilder()
  .setName("tournament")
  .setDescription("Manage tournaments, registration, matches, and staff operations")
  .setDMPermission(false)
  .addSubcommandGroup((group) =>
    group
      .setName("lifecycle")
      .setDescription("Tournament lifecycle management")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("create")
          .setDescription("Create a new tournament")
          .addStringOption(stringOption("name", "Tournament name", true))
          .addStringOption((option) =>
            option
              .setName("format")
              .setDescription("Bracket format")
              .setRequired(true)
              .addChoices(
                { name: "Single Elimination", value: "SINGLE_ELIMINATION" },
                { name: "Double Elimination", value: "DOUBLE_ELIMINATION" }
              )
          )
          .addIntegerOption(intOption("max_participants", "Maximum participant count", 2, 4096, true))
          .addIntegerOption(intOption("best_of", "Default match format", 1, 11, true))
          .addBooleanOption(boolOption("require_checkin", "Require players to check in before start"))
          .addBooleanOption(boolOption("allow_waitlist", "Allow a waitlist once the bracket is full"))
          .addStringOption(stringOption("description", "Tournament description"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("config")
          .setDescription("Configure tournament settings")
          .addStringOption(tournamentIdOption())
          .addStringOption((option) =>
            option
              .setName("seeding")
              .setDescription("Seeding method")
              .addChoices(
                { name: "Random", value: "RANDOM" },
                { name: "Manual", value: "MANUAL" },
                { name: "Rating Based", value: "RATING_BASED" }
              )
          )
          .addStringOption(stringOption("mutual_exclusion_key", "Mutual exclusion bucket"))
          .addBooleanOption(boolOption("require_opponent_confirmation", "Require opponent confirmation for self-reported scores"))
          .addBooleanOption(boolOption("grand_finals_reset", "Enable grand finals reset in double elimination"))
          .addBooleanOption(boolOption("allow_withdrawals", "Allow players to leave before the event starts"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("open")
          .setDescription("Open registration for a tournament")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("close")
          .setDescription("Close registration or move to check-in")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("start")
          .setDescription("Start a tournament and generate the bracket")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("pause")
          .setDescription("Pause an in-progress tournament")
          .addStringOption(tournamentIdOption())
          .addStringOption(reasonOption("Reason for pausing the tournament"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("resume")
          .setDescription("Resume a paused tournament")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("cancel")
          .setDescription("Cancel a tournament")
          .addStringOption(tournamentIdOption())
          .addStringOption(reasonOption("Reason for cancelling the tournament"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("finalize")
          .setDescription("Finalize results and placements")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("archive")
          .setDescription("Archive a completed or cancelled tournament")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("settings")
          .setDescription("View current tournament settings")
          .addStringOption(tournamentIdOption())
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("registration")
      .setDescription("Participant registration and check-in")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("join")
          .setDescription("Join a tournament")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("leave")
          .setDescription("Leave a tournament before it starts")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("checkin")
          .setDescription("Check in for a tournament")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("participants")
          .setDescription("View the participant list")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("waitlist")
          .setDescription("View the waitlist")
          .addStringOption(tournamentIdOption())
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("match")
      .setDescription("Match reporting and player match flow")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("view")
          .setDescription("View your current match or a specific match")
          .addStringOption(tournamentIdOption())
          .addStringOption(stringOption("match_id", "Specific match ID"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("report")
          .setDescription("Report a match result")
          .addStringOption(tournamentIdOption())
          .addStringOption(stringOption("match_id", "Match ID", true))
          .addStringOption(stringOption("winner_id", "Winner registration or entrant ID", true))
          .addStringOption(stringOption("loser_id", "Loser registration or entrant ID", true))
          .addStringOption((option) =>
            option
              .setName("outcome")
              .setDescription("How the match was decided")
              .setRequired(true)
              .addChoices(...outcomeChoices)
          )
          .addIntegerOption(intOption("winner_score", "Winner score for score-based reports", 0, 99))
          .addIntegerOption(intOption("loser_score", "Loser score for score-based reports", 0, 99))
          .addStringOption(stringOption("reason", "Optional context for no-show, walkover, or issues"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("confirm")
          .setDescription("Confirm a pending result report")
          .addStringOption(tournamentIdOption())
          .addStringOption(stringOption("report_id", "Result report ID", true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("dispute")
          .setDescription("Dispute a pending result report")
          .addStringOption(tournamentIdOption())
          .addStringOption(stringOption("report_id", "Result report ID", true))
          .addStringOption(reasonOption("Reason for disputing the result"))
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("bracket")
      .setDescription("Bracket and tournament overview")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("view")
          .setDescription("View a tournament overview")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("round")
          .setDescription("View a specific round")
          .addStringOption(tournamentIdOption())
          .addStringOption((option) =>
            option
              .setName("side")
              .setDescription("Bracket side")
              .setRequired(true)
              .addChoices(
                { name: "Winners", value: "WINNERS" },
                { name: "Losers", value: "LOSERS" },
                { name: "Grand Finals", value: "GRAND_FINALS" }
              )
          )
          .addIntegerOption(intOption("round_number", "Round number", 1, 32, true))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("match")
          .setDescription("View detailed match information")
          .addStringOption(tournamentIdOption())
          .addStringOption(stringOption("match_id", "Match ID", true))
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("staff")
      .setDescription("Staff tools and moderation actions")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("panel")
          .setDescription("Open the staff control panel")
          .addStringOption(tournamentIdOption())
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("advance")
          .setDescription("Force-advance a match")
          .addStringOption(tournamentIdOption())
          .addStringOption(stringOption("match_id", "Match ID", true))
          .addStringOption(stringOption("winner_id", "Winner registration or entrant ID", true))
          .addStringOption(reasonOption("Reason for forcing the result"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("dq")
          .setDescription("Disqualify a participant")
          .addStringOption(tournamentIdOption())
          .addUserOption(userOption("Participant to disqualify"))
          .addStringOption(reasonOption("Reason for the disqualification"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("drop")
          .setDescription("Drop a participant from the tournament")
          .addStringOption(tournamentIdOption())
          .addUserOption(userOption("Participant to drop"))
          .addStringOption(reasonOption("Reason for dropping the participant"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("forcejoin")
          .setDescription("Force add a participant to registration")
          .addStringOption(tournamentIdOption())
          .addUserOption(userOption("User to add"))
          .addStringOption(reasonOption("Reason for force-joining the user"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remove")
          .setDescription("Remove a participant from registration or bracket")
          .addStringOption(tournamentIdOption())
          .addUserOption(userOption("User to remove"))
          .addStringOption(reasonOption("Reason for removing the user"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("reseed")
          .setDescription("Reseed the tournament before start")
          .addStringOption(tournamentIdOption())
          .addStringOption((option) =>
            option
              .setName("method")
              .setDescription("New seeding method")
              .setRequired(true)
              .addChoices(
                { name: "Random", value: "RANDOM" },
                { name: "Manual", value: "MANUAL" },
                { name: "Rating Based", value: "RATING_BASED" }
              )
          )
          .addStringOption(reasonOption("Reason for reseeding"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remake")
          .setDescription("Rebuild the bracket from current seeds")
          .addStringOption(tournamentIdOption())
          .addStringOption(reasonOption("Reason for remaking the bracket"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("override")
          .setDescription("Override a reported result")
          .addStringOption(tournamentIdOption())
          .addStringOption(stringOption("match_id", "Match ID", true))
          .addStringOption(stringOption("winner_id", "Winner registration or entrant ID", true))
          .addStringOption(stringOption("loser_id", "Loser registration or entrant ID", true))
          .addStringOption((option) =>
            option
              .setName("outcome")
              .setDescription("How the match was decided")
              .setRequired(true)
              .addChoices(...outcomeChoices)
          )
          .addIntegerOption(intOption("winner_score", "Winner score for score-based overrides", 0, 99))
          .addIntegerOption(intOption("loser_score", "Loser score for score-based overrides", 0, 99))
          .addStringOption(reasonOption("Reason for the override"))
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("undo")
          .setDescription("Undo the most recent reversible staff action")
          .addStringOption(tournamentIdOption())
          .addStringOption(reasonOption("Reason for the undo"))
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

export const tournamentCommand: CommandModule = {
  name: "tournament",
  definition: tournamentCommandBuilder,
  async execute(interaction: ChatInputCommandInteraction, context: BootstrapContext): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "This command can only be used inside a server.",
          ephemeral: true
        });
        return;
      }

      const group = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand(true);
      const member = await interaction.guild!.members.fetch(interaction.user.id);

      if (group === "registration") {
        const tournamentId = interaction.options.getString("tournament_id", true);
        const displayName = member.displayName ?? interaction.user.username;

        switch (subcommand) {
          case "join": {
            const result = await context.registrationService.joinTournament({
              guildId: interaction.guildId!,
              tournamentId,
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

          case "leave": {
            const result = await context.registrationService.leaveTournament({
              guildId: interaction.guildId!,
              tournamentId,
              actorUserId: interaction.user.id
            });

            await interaction.reply({
              content: result.leftWaitlist
                ? "You were removed from the waitlist."
                : "You have successfully left the tournament.",
              ephemeral: true
            });
            return;
          }

          case "checkin": {
            await context.registrationService.checkIn({
              guildId: interaction.guildId!,
              tournamentId,
              actorUserId: interaction.user.id
            });

            await interaction.reply({
              content: "Check-in recorded successfully.",
              ephemeral: true
            });
            return;
          }

          default:
            await interaction.reply({
              content: "This registration command is registered but not wired yet.",
              ephemeral: true
            });
            return;
        }
      }

      if (group === "match") {
        const tournamentId = interaction.options.getString("tournament_id", true);

        switch (subcommand) {
          case "view": {
            const view = await context.matchReportingService.getMatchView({
              guildId: interaction.guildId!,
              tournamentId,
              actorUserId: interaction.user.id,
              matchId: interaction.options.getString("match_id") ?? undefined
            });

            const latestReportLine =
              view.latestReport == null
                ? "Latest report: none"
                : `Latest report: ${view.latestReport.id} (${view.latestReport.status}, ${view.latestReport.outcomeType})`;

            await interaction.reply({
              content: [
                `Tournament: ${view.tournamentName}`,
                `Match: ${view.matchId}`,
                `Status: ${view.status}`,
                `Bracket: ${view.bracketType}`,
                `Players: ${view.player1} vs ${view.player2}`,
                `Best of: ${view.bestOf}`,
                latestReportLine
              ].join("\n"),
              ephemeral: true
            });
            return;
          }

          case "report": {
            const result = await context.matchReportingService.reportResult({
              guildId: interaction.guildId!,
              tournamentId,
              actorUserId: interaction.user.id,
              matchId: interaction.options.getString("match_id", true),
              winnerRegistrationId: interaction.options.getString("winner_id", true),
              loserRegistrationId: interaction.options.getString("loser_id", true),
              outcomeType: interaction.options.getString("outcome", true) as MatchOutcomeType,
              winnerScore: interaction.options.getInteger("winner_score"),
              loserScore: interaction.options.getInteger("loser_score"),
              reason: interaction.options.getString("reason"),
              idempotencyKey: interaction.id
            });

            await interaction.reply({
              content: `Result report ${result.reportId} recorded. Opponent confirmation is now required.`,
              ephemeral: true
            });
            return;
          }

          case "confirm": {
            const result = await context.matchReportingService.confirmResult({
              guildId: interaction.guildId!,
              tournamentId,
              actorUserId: interaction.user.id,
              reportId: interaction.options.getString("report_id", true)
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
            await context.matchReportingService.disputeResult({
              guildId: interaction.guildId!,
              tournamentId,
              actorUserId: interaction.user.id,
              reportId: interaction.options.getString("report_id", true),
              reason: interaction.options.getString("reason", true)
            });

            await interaction.reply({
              content: "Result report disputed. Staff review or a new report is now required.",
              ephemeral: true
            });
            return;
          }

          default:
            await interaction.reply({
              content: "This match command is registered but not wired yet.",
              ephemeral: true
            });
            return;
        }
      }

      if (group === "lifecycle") {
        await context.permissionService.requireMinimumRole(
          interaction.guildId!,
          member,
          StaffRoleType.TOURNAMENT_STAFF,
          `command.lifecycle.${subcommand}`
        );

        switch (subcommand) {
          case "create": {
            const created = await context.adminTournamentService.createTournament({
              guildId: interaction.guildId!,
              actorUserId: interaction.user.id,
              name: interaction.options.getString("name", true),
              description: interaction.options.getString("description"),
              format: interaction.options.getString("format", true) as TournamentFormat,
              maxParticipants: interaction.options.getInteger("max_participants", true),
              bestOfDefault: interaction.options.getInteger("best_of", true),
              requireCheckIn: interaction.options.getBoolean("require_checkin") ?? false,
              allowWaitlist: interaction.options.getBoolean("allow_waitlist") ?? true
            });

            await interaction.reply({
              content: `Tournament created: ${created.name} (${created.id})`,
              ephemeral: true
            });
            return;
          }

          case "config": {
            const updated = await context.adminTournamentService.configureTournament({
              guildId: interaction.guildId!,
              tournamentId: interaction.options.getString("tournament_id", true),
              actorUserId: interaction.user.id,
              seedingMethod:
                (interaction.options.getString("seeding") as SeedingMethod | null) ?? undefined,
              mutualExclusionKey: interaction.options.getString("mutual_exclusion_key"),
              requireOpponentConfirmation:
                interaction.options.getBoolean("require_opponent_confirmation") ?? undefined,
              grandFinalResetEnabled:
                interaction.options.getBoolean("grand_finals_reset") ?? undefined,
              allowWithdrawals: interaction.options.getBoolean("allow_withdrawals") ?? undefined
            });

            await interaction.reply({
              content: `Tournament configuration updated for ${updated.name}.`,
              ephemeral: true
            });
            return;
          }

          case "open":
            await context.adminTournamentService.openTournament({
              guildId: interaction.guildId!,
              tournamentId: interaction.options.getString("tournament_id", true),
              actorUserId: interaction.user.id
            });
            await interaction.reply({ content: "Registration opened.", ephemeral: true });
            return;

          case "close":
            await context.adminTournamentService.closeTournament({
              guildId: interaction.guildId!,
              tournamentId: interaction.options.getString("tournament_id", true),
              actorUserId: interaction.user.id
            });
            await interaction.reply({ content: "Registration closed.", ephemeral: true });
            return;

          case "start":
            await context.adminTournamentService.startTournament({
              guildId: interaction.guildId!,
              tournamentId: interaction.options.getString("tournament_id", true),
              actorUserId: interaction.user.id
            });
            await interaction.reply({
              content: "Tournament started and bracket generated.",
              ephemeral: true
            });
            return;

          case "cancel":
            await context.adminTournamentService.cancelTournament({
              guildId: interaction.guildId!,
              tournamentId: interaction.options.getString("tournament_id", true),
              actorUserId: interaction.user.id,
              reason: interaction.options.getString("reason", true)
            });
            await interaction.reply({
              content: "Tournament cancelled successfully.",
              ephemeral: true
            });
            return;

          case "finalize":
            await context.adminTournamentService.finalizeTournament({
              guildId: interaction.guildId!,
              tournamentId: interaction.options.getString("tournament_id", true),
              actorUserId: interaction.user.id
            });
            await interaction.reply({
              content: "Tournament finalized successfully.",
              ephemeral: true
            });
            return;

          case "settings": {
            const tournament = await context.adminTournamentService.getTournamentSettings({
              guildId: interaction.guildId!,
              tournamentId: interaction.options.getString("tournament_id", true),
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
        }
      }

      if (group === "staff") {
        const tournamentId = interaction.options.getString("tournament_id", true);

        if (subcommand === "dq" || subcommand === "drop") {
          await context.permissionService.requireMinimumRole(
            interaction.guildId!,
            member,
            StaffRoleType.MODERATOR,
            `command.staff.${subcommand}`
          );

          const target = interaction.options.getUser("user", true);
          const reason = interaction.options.getString("reason", true);

          if (subcommand === "dq") {
            await context.adminTournamentService.disqualifyParticipant({
              guildId: interaction.guildId!,
              tournamentId,
              actorUserId: interaction.user.id,
              targetUserId: target.id,
              reason
            });

            await interaction.reply({
              content: `Participant ${target.tag} was disqualified.`,
              ephemeral: true
            });
            return;
          }

          await context.adminTournamentService.dropParticipant({
            guildId: interaction.guildId!,
            tournamentId,
            actorUserId: interaction.user.id,
            targetUserId: target.id,
            reason
          });

          await interaction.reply({
            content: `Participant ${target.tag} was dropped from the tournament.`,
            ephemeral: true
          });
          return;
        }

        if (subcommand === "reseed") {
          await context.permissionService.requireMinimumRole(
            interaction.guildId!,
            member,
            StaffRoleType.TOURNAMENT_STAFF,
            "command.staff.reseed"
          );

          await context.adminTournamentService.reseedTournament({
            guildId: interaction.guildId!,
            tournamentId,
            actorUserId: interaction.user.id,
            method: interaction.options.getString("method", true) as SeedingMethod
          });

          await interaction.reply({
            content: "Tournament seeds updated successfully.",
            ephemeral: true
          });
          return;
        }

        if (subcommand === "override") {
          await context.permissionService.requireMinimumRole(
            interaction.guildId!,
            member,
            StaffRoleType.MODERATOR,
            "command.staff.override"
          );

          const result = await context.matchReportingService.overrideResult({
            guildId: interaction.guildId!,
            tournamentId,
            actorUserId: interaction.user.id,
            matchId: interaction.options.getString("match_id", true),
            winnerRegistrationId: interaction.options.getString("winner_id", true),
            loserRegistrationId: interaction.options.getString("loser_id", true),
            outcomeType: interaction.options.getString("outcome", true) as MatchOutcomeType,
            winnerScore: interaction.options.getInteger("winner_score"),
            loserScore: interaction.options.getInteger("loser_score"),
            reason: interaction.options.getString("reason", true),
            idempotencyKey: interaction.id
          });

          await interaction.reply({
            content: result.finalized
              ? `Override applied. Match advanced and the tournament is now finalized with champion ${result.championRegistrationId}.`
              : "Override applied and bracket advanced successfully.",
            ephemeral: true
          });
          return;
        }
      }

      await interaction.reply({
        content: "This command is registered, but execution has not been wired yet.",
        ephemeral: true
      });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.safeMessage
          : "An unexpected error occurred while handling this command.";

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: message,
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: message,
        ephemeral: true
      });
    }
  }
};
