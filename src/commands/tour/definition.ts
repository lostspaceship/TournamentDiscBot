import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import {
  addRequiredReasonOption,
  addTournamentIdOption,
  boolOption,
  channelOption,
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
      .setDescription("Create a tournament with a live info post and bracket post")
      .addChannelOption((option) =>
        channelOption("channel", "Channel to keep the tournament info and bracket updated", true)(
          option
        ).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addStringOption(stringOption("name", "Tournament name"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("config").setDescription("Update tournament configuration"), "Tournament name or slug", false)
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
    addTournamentIdOption(subcommand.setName("open").setDescription("Open registration"), "Tournament name or slug", false)
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("close")
      .setDescription("Lock registration and build the bracket")
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(
      subcommand
        .setName("start")
        .setDescription("Alias for close: lock registration and build the bracket"),
      "Tournament name or slug",
      false
    )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("join").setDescription("Join a tournament")
      .addStringOption(stringOption("name", "Name to show on the bracket", true))
      .addStringOption(stringOption("league_ign", "Your League ID, for example test#test", true))
      .addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("leave").setDescription("Leave a tournament before it starts"), "Tournament name or slug", false)
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("checkin").setDescription("Check in for a tournament"), "Tournament name or slug", false)
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("view").setDescription("View tournament overview"), "Tournament name or slug", false)
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("participants").setDescription("View tournament participants"), "Tournament name or slug", false)
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("bracket").setDescription("View bracket or preview"), "Tournament name or slug", false)
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
    subcommand.setName("match").setDescription("View your current match or a specific match")
      .addStringOption(stringOption("match_id", "Specific match ID"))
      .addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
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
      .addIntegerOption(intOption("winner_score", "Winner score", { minValue: 0, maxValue: 99 }))
      .addIntegerOption(intOption("loser_score", "Loser score", { minValue: 0, maxValue: 99 }))
      .addStringOption(stringOption("reason", "Optional context"))
      .addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("confirm").setDescription("Confirm a result report")
      .addStringOption(stringOption("report_id", "Result report ID", true))
      .addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
    addRequiredReasonOption(
      subcommand.setName("dispute").setDescription("Dispute a result report").addStringOption(
        stringOption("report_id", "Result report ID", true)
      ),
      "Reason for disputing the result"
    ).addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("advance")
      .setDescription("Force-advance a player from their current active match")
      .addUserOption(userOption("user", "Discord user to advance"))
      .addStringOption(stringOption("name", "Bracket name or fake bot name to advance"))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("addfake")
      .setDescription("Temp staff command to add fake players for testing")
      .addIntegerOption(
        intOption("count", "How many fake players to add", {
          minValue: 1,
          maxValue: 64,
          required: true
        })
      )
      .addStringOption(stringOption("prefix", "Name prefix for the fake players"))
  )
  .addSubcommand((subcommand) =>
    addRequiredReasonOption(
      subcommand
        .setName("dq")
        .setDescription("Disqualify a participant")
        .addUserOption(userOption("user", "Participant to disqualify", true)),
      "Reason for the disqualification"
    ).addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
    addRequiredReasonOption(
      subcommand
        .setName("drop")
        .setDescription("Drop a participant")
        .addUserOption(userOption("user", "Participant to drop", true)),
      "Reason for dropping the participant"
    ).addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
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
    ).addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
    addRequiredReasonOption(subcommand.setName("cancel").setDescription("Cancel a tournament"), "Reason for cancelling the tournament")
      .addStringOption(stringOption("tournament_id", "Tournament name or slug"))
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("finish").setDescription("Finalize tournament results")
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("staff").setDescription("Open the staff panel"), "Tournament name or slug", false)
  )
  .addSubcommand((subcommand) =>
    addTournamentIdOption(subcommand.setName("settings").setDescription("View current tournament settings"), "Tournament name or slug", false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
