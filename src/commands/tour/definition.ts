import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import {
  addRequiredReasonOption,
  addTournamentIdOption,
  boolOption,
  intOption,
  stringOption,
  userOption
} from "../tournament/options.js";

const outcomeChoices = [
  { name: "Score Report", value: "SCORE" },
  { name: "No Show", value: "NO_SHOW" },
  { name: "Disqualification", value: "DISQUALIFICATION" },
  { name: "Walkover", value: "WALKOVER" }
] as const;

export const tourCommandDefinition = new SlashCommandBuilder()
  .setName("tour")
  .setDescription("Tournament lifecycle, bracket, match, and staff actions")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a tournament")
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
      .addIntegerOption(
        intOption("max_participants", "Maximum participant count", {
          minValue: 2,
          maxValue: 4096,
          required: true
        })
      )
      .addIntegerOption(
        intOption("best_of", "Default match format", {
          minValue: 1,
          maxValue: 11,
          required: true
        })
      )
      .addBooleanOption(boolOption("require_checkin", "Require players to check in before start"))
      .addBooleanOption(boolOption("allow_waitlist", "Allow waitlist once capacity is reached"))
      .addStringOption(stringOption("description", "Tournament description"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("config").setDescription("Update tournament configuration"))
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
      .addBooleanOption(boolOption("require_opponent_confirmation", "Require opponent confirmation"))
      .addBooleanOption(boolOption("grand_finals_reset", "Enable grand finals reset"))
      .addBooleanOption(boolOption("allow_withdrawals", "Allow player withdrawals before start"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("open").setDescription("Open registration"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("close").setDescription("Close registration or move to check-in"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("start").setDescription("Start the tournament and lock the bracket"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("join").setDescription("Join a tournament"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("leave").setDescription("Leave a tournament before it starts"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("checkin").setDescription("Check in for a tournament"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("view").setDescription("View tournament overview"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("participants").setDescription("View tournament participants"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("bracket").setDescription("View bracket or preview"))
      .addStringOption((option) =>
        option
          .setName("side")
          .setDescription("Bracket side")
          .addChoices(
            { name: "Winners", value: "WINNERS" },
            { name: "Losers", value: "LOSERS" },
            { name: "Grand Finals", value: "GRAND_FINALS" }
          )
      )
      .addIntegerOption(
        intOption("round_number", "Round number", {
          minValue: 1,
          maxValue: 64
        })
      )
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("match").setDescription("View your current match or a specific match"))
      .addStringOption(stringOption("match_id", "Specific match ID"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      subcommand
        .setName("report")
        .setDescription("Report a match result")
        .addStringOption(stringOption("match_id", "Match ID", true))
        .addStringOption(stringOption("winner_id", "Winner registration ID", true))
        .addStringOption(stringOption("loser_id", "Loser registration ID", true))
        .addStringOption((option) =>
          option
            .setName("outcome")
            .setDescription("How the match was decided")
            .setRequired(true)
            .addChoices(...outcomeChoices)
        )
    )
      .addIntegerOption(intOption("winner_score", "Winner score", { minValue: 0, maxValue: 99 }))
      .addIntegerOption(intOption("loser_score", "Loser score", { minValue: 0, maxValue: 99 }))
      .addStringOption(stringOption("reason", "Optional context"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("confirm").setDescription("Confirm a result report"))
      .addStringOption(stringOption("report_id", "Result report ID", true))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      addRequiredReasonOption(
        subcommand.setName("dispute").setDescription("Dispute a result report").addStringOption(
          stringOption("report_id", "Result report ID", true)
        ),
        "Reason for disputing the result"
      )
    )
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      addRequiredReasonOption(
        subcommand
          .setName("advance")
          .setDescription("Force-advance the selected player through a match")
          .addStringOption(stringOption("match_id", "Match ID", true))
          .addStringOption(stringOption("winner_id", "Winner registration ID", true)),
        "Reason for the staff advance"
      )
    )
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      addRequiredReasonOption(
        subcommand
          .setName("dq")
          .setDescription("Disqualify a participant")
          .addUserOption(userOption("user", "Participant to disqualify", true)),
        "Reason for the disqualification"
      )
    )
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      addRequiredReasonOption(
        subcommand
          .setName("drop")
          .setDescription("Drop a participant")
          .addUserOption(userOption("user", "Participant to drop", true)),
        "Reason for dropping the participant"
      )
    )
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      addRequiredReasonOption(
        subcommand
          .setName("reseed")
          .setDescription("Reseed the tournament before start")
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
          ),
        "Reason for reseeding"
      )
    )
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      addRequiredReasonOption(subcommand.setName("cancel").setDescription("Cancel a tournament"), "Reason for cancelling the tournament")
    )
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("finish").setDescription("Finalize tournament results"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("staff").setDescription("Open the staff panel"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("settings").setDescription("View current tournament settings"))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
