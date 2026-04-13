import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";
import { StaffRoleType } from "@prisma/client";

import type { BotContext } from "../types/bot.js";
import {
  buildResultActionRow,
  errorReply,
  formatParticipantLine,
  successReply,
  tournamentOverviewEmbed
} from "../utils/discord.js";
import { AppError } from "../utils/errors.js";

const getRequiredString = (interaction: ChatInputCommandInteraction, name: string) =>
  interaction.options.getString(name, true);

const getRequiredInteger = (interaction: ChatInputCommandInteraction, name: string) =>
  interaction.options.getInteger(name, true);

const getRequiredBoolean = (interaction: ChatInputCommandInteraction, name: string) =>
  interaction.options.getBoolean(name, true);

export const tournamentCommand = {
  data: {
    name: "tournament",
    description: "Manage competitive tournaments",
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.SendMessages,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "create",
        description: "Create a tournament",
        options: [
          { type: ApplicationCommandOptionType.String, name: "name", description: "Tournament name", required: true },
          { type: ApplicationCommandOptionType.String, name: "format", description: "Bracket format", required: true, choices: [{ name: "Single elimination", value: "SINGLE_ELIMINATION" }, { name: "Double elimination", value: "DOUBLE_ELIMINATION" }] },
          { type: ApplicationCommandOptionType.Integer, name: "max_participants", description: "Capacity", required: true },
          { type: ApplicationCommandOptionType.Integer, name: "best_of", description: "Default match length", required: true },
          { type: ApplicationCommandOptionType.Boolean, name: "checkin", description: "Require check-in", required: true },
          { type: ApplicationCommandOptionType.Boolean, name: "waitlist", description: "Enable waitlist", required: true },
          { type: ApplicationCommandOptionType.String, name: "description", description: "Tournament description", required: false }
        ]
      },
      { type: ApplicationCommandOptionType.Subcommand, name: "open", description: "Open registration", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "close", description: "Close registration", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "start", description: "Start a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "view", description: "View tournament overview", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "participants", description: "List participants", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "bracket", description: "View bracket summary", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "join", description: "Join a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "leave", description: "Leave a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "checkin", description: "Check in to your tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "match", description: "View your active matches", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "report",
        description: "Report a match result",
        options: [
          { type: ApplicationCommandOptionType.String, name: "tournament_id", description: "Tournament ID", required: true },
          { type: ApplicationCommandOptionType.String, name: "match_id", description: "Match ID", required: true },
          { type: ApplicationCommandOptionType.String, name: "winner_registration_id", description: "Winner registration ID", required: true },
          { type: ApplicationCommandOptionType.String, name: "loser_registration_id", description: "Loser registration ID", required: true },
          { type: ApplicationCommandOptionType.Integer, name: "player1_score", description: "Player 1 score", required: true },
          { type: ApplicationCommandOptionType.Integer, name: "player2_score", description: "Player 2 score", required: true },
          { type: ApplicationCommandOptionType.String, name: "reason", description: "Reason or note", required: false }
        ]
      },
      { type: ApplicationCommandOptionType.Subcommand, name: "pause", description: "Pause a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "resume", description: "Resume a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "cancel", description: "Cancel a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }, { type: ApplicationCommandOptionType.String, name: "reason", description: "Reason", required: false }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "finalize", description: "Finalize a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "archive", description: "Archive a tournament", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: "staffpanel", description: "View staff actions", options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Tournament ID", required: true }] }
    ]
  },
  async execute(interaction: ChatInputCommandInteraction, member: GuildMember, bot: BotContext) {
    try {
      const subcommand = interaction.options.getSubcommand(true);

      if (["create", "open", "close", "start", "pause", "resume", "cancel", "finalize", "archive", "staffpanel"].includes(subcommand)) {
        await bot.tournamentService.permissionService.requireRole(
          interaction.guildId!,
          member,
          StaffRoleType.TOURNAMENT_STAFF
        );
      }

      switch (subcommand) {
        case "create": {
          const created = await bot.tournamentService.createTournament({
            guildId: interaction.guildId!,
            actorUserId: interaction.user.id,
            input: {
              name: getRequiredString(interaction, "name"),
              description: interaction.options.getString("description") ?? undefined,
              format: getRequiredString(interaction, "format"),
              maxParticipants: getRequiredInteger(interaction, "max_participants"),
              bestOfDefault: getRequiredInteger(interaction, "best_of"),
              requireCheckIn: getRequiredBoolean(interaction, "checkin"),
              allowWaitlist: getRequiredBoolean(interaction, "waitlist"),
              allowWithdrawals: true
            }
          });
          await interaction.reply({ ephemeral: true, embeds: [tournamentOverviewEmbed(created)] });
          return;
        }
        case "open":
          await bot.tournamentService.openRegistration(
            getRequiredString(interaction, "id"),
            interaction.guildId!,
            interaction.user.id
          );
          await interaction.reply(successReply("Registration opened."));
          return;
        case "close":
          await bot.tournamentService.closeRegistration(
            getRequiredString(interaction, "id"),
            interaction.guildId!,
            interaction.user.id
          );
          await interaction.reply(successReply("Registration closed."));
          return;
        case "start":
          await bot.tournamentService.startTournament({
            guildId: interaction.guildId!,
            tournamentId: getRequiredString(interaction, "id"),
            actorUserId: interaction.user.id
          });
          await interaction.reply(successReply("Tournament started and bracket generated."));
          return;
        case "view": {
          const tournament = (await bot.tournamentService.getTournamentOverview(
            getRequiredString(interaction, "id"),
            interaction.guildId!
          )) as any;
          await interaction.reply({ embeds: [tournamentOverviewEmbed(tournament)], ephemeral: false });
          return;
        }
        case "participants": {
          const tournament = (await bot.tournamentService.getTournamentOverview(
            getRequiredString(interaction, "id"),
            interaction.guildId!
          )) as any;
          const lines = tournament.registrations.slice(0, 25).map((registration: any) => formatParticipantLine(registration));
          await interaction.reply({
            ephemeral: true,
            embeds: [
              new EmbedBuilder()
                .setTitle(`${tournament.name} Participants`)
                .setDescription(lines.length > 0 ? lines.join("\n") : "No participants yet.")
            ]
          });
          return;
        }
        case "bracket": {
          const tournament = (await bot.tournamentService.getTournamentOverview(
            getRequiredString(interaction, "id"),
            interaction.guildId!
          )) as any;
          const lines = tournament.brackets.flatMap((bracket: any) =>
            bracket.rounds.map((round: any) => `${bracket.type} R${round.roundNumber}: ${round.matches.length} matches`)
          );
          await interaction.reply({
            ephemeral: true,
            embeds: [
              new EmbedBuilder()
                .setTitle(`${tournament.name} Bracket`)
                .setDescription(lines.join("\n") || "Bracket not generated yet.")
            ]
          });
          return;
        }
        case "join": {
          const result = await bot.tournamentService.joinTournament({
            guildId: interaction.guildId!,
            tournamentId: getRequiredString(interaction, "id"),
            userId: interaction.user.id,
            displayName: member.displayName
          });
          await interaction.reply(
            successReply(
              result.waitlist
                ? "Tournament is full. You were added to the waitlist."
                : "You have joined the tournament."
            )
          );
          return;
        }
        case "leave":
          await bot.tournamentService.leaveTournament({
            guildId: interaction.guildId!,
            tournamentId: getRequiredString(interaction, "id"),
            userId: interaction.user.id
          });
          await interaction.reply(successReply("You have left the tournament."));
          return;
        case "checkin":
          await bot.tournamentService.checkIn({
            guildId: interaction.guildId!,
            tournamentId: getRequiredString(interaction, "id"),
            userId: interaction.user.id
          });
          await interaction.reply(successReply("Check-in recorded."));
          return;
        case "match": {
          const matches = await bot.tournamentService.getParticipantMatches({
            guildId: interaction.guildId!,
            tournamentId: getRequiredString(interaction, "id"),
            userId: interaction.user.id
          });
          const description = matches.length
            ? matches.map((match) => `${match.id} - ${match.round.name} - ${match.status}`).join("\n")
            : "No active matches found.";
          await interaction.reply({
            ephemeral: true,
            embeds: [new EmbedBuilder().setTitle("Your Matches").setDescription(description)]
          });
          return;
        }
        case "report": {
          const tournamentId = getRequiredString(interaction, "tournament_id");
          const report = await bot.tournamentService.reportResult({
            guildId: interaction.guildId!,
            tournamentId,
            actorUserId: interaction.user.id,
            input: {
              matchId: getRequiredString(interaction, "match_id"),
              winnerRegistrationId: getRequiredString(interaction, "winner_registration_id"),
              loserRegistrationId: getRequiredString(interaction, "loser_registration_id"),
              player1Score: getRequiredInteger(interaction, "player1_score"),
              player2Score: getRequiredInteger(interaction, "player2_score"),
              reason: interaction.options.getString("reason") ?? undefined,
              idempotencyKey: interaction.id
            }
          });

          if (report.status === "AWAITING_CONFIRMATION") {
            await interaction.reply({
              ephemeral: true,
              embeds: [
                new EmbedBuilder()
                  .setTitle("Result Submitted")
                  .setDescription("Result submitted and awaiting opponent confirmation.")
                  .setFooter({ text: `Tournament ID: ${tournamentId}` })
              ],
              components: [buildResultActionRow(tournamentId, report.id)]
            });
            return;
          }

          await interaction.reply(successReply("Result confirmed and bracket advanced."));
          return;
        }
        case "pause":
          await bot.tournamentService.pauseTournament(
            getRequiredString(interaction, "id"),
            interaction.guildId!,
            interaction.user.id
          );
          await interaction.reply(successReply("Tournament paused."));
          return;
        case "resume":
          await bot.tournamentService.resumeTournament(
            getRequiredString(interaction, "id"),
            interaction.guildId!,
            interaction.user.id
          );
          await interaction.reply(successReply("Tournament resumed."));
          return;
        case "cancel":
          await bot.tournamentService.cancelTournament(
            getRequiredString(interaction, "id"),
            interaction.guildId!,
            interaction.user.id,
            interaction.options.getString("reason") ?? undefined
          );
          await interaction.reply(successReply("Tournament cancelled."));
          return;
        case "finalize":
          await bot.tournamentService.finalizeTournament(
            getRequiredString(interaction, "id"),
            interaction.guildId!,
            interaction.user.id
          );
          await interaction.reply(successReply("Tournament finalized."));
          return;
        case "archive":
          await bot.tournamentService.archiveTournament(
            getRequiredString(interaction, "id"),
            interaction.guildId!,
            interaction.user.id
          );
          await interaction.reply(successReply("Tournament archived."));
          return;
        case "staffpanel": {
          const tournament = (await bot.tournamentService.getTournamentOverview(
            getRequiredString(interaction, "id"),
            interaction.guildId!
          )) as any;
          await interaction.reply({
            ephemeral: true,
            embeds: [
              new EmbedBuilder()
                .setTitle(`${tournament.name} Staff Panel`)
                .setDescription(
                  [
                    `Status: ${tournament.status}`,
                    `Participants: ${tournament.registrations.length}`,
                    `Waitlist: ${tournament.waitlistEntries.length}`,
                    `Audit entries: ${tournament.auditLogs.length}`
                  ].join("\n")
                )
            ]
          });
          return;
        }
        default:
          await interaction.reply(errorReply("Unknown subcommand."));
      }
    } catch (error) {
      const message = error instanceof AppError ? error.safeMessage : "An unexpected error occurred.";
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(errorReply(message));
      }
    }
  }
};
