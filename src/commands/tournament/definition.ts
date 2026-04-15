import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import {
  addRequiredReasonOption,
  addTournamentIdOption,
  boolOption,
  intOption,
  stringOption,
  userOption
} from "./options.js";

const outcomeChoices = [
  { name: "Score Report", value: "SCORE" },
  { name: "No Show", value: "NO_SHOW" },
  { name: "Disqualification", value: "DISQUALIFICATION" },
  { name: "Walkover", value: "WALKOVER" }
] as const;

export const tournamentCommandDefinition = new SlashCommandBuilder()
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
          .addBooleanOption(boolOption("allow_waitlist", "Allow a waitlist once the bracket is full"))
          .addStringOption(stringOption("description", "Tournament description"))
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand
            .setName("config")
            .setDescription("Configure tournament settings")
        )
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
        addTournamentIdOption(
          subcommand.setName("open").setDescription("Open registration for a tournament")
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand.setName("close").setDescription("Close registration or move to check-in")
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand.setName("start").setDescription("Start a tournament and generate the bracket")
        )
      )
      .addSubcommand((subcommand) =>
        addRequiredReasonOption(
          addTournamentIdOption(
            subcommand.setName("pause").setDescription("Pause an in-progress tournament")
          ),
          "Reason for pausing the tournament"
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand.setName("resume").setDescription("Resume a paused tournament")
        )
      )
      .addSubcommand((subcommand) =>
        addRequiredReasonOption(
          addTournamentIdOption(
            subcommand.setName("cancel").setDescription("Cancel a tournament")
          ),
          "Reason for cancelling the tournament"
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand.setName("finalize").setDescription("Finalize results and placements")
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand.setName("archive").setDescription("Archive a completed or cancelled tournament")
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand.setName("settings").setDescription("View current tournament settings")
        )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("registration")
      .setDescription("Participant registration and check-in")
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
        addTournamentIdOption(subcommand.setName("participants").setDescription("View the participant list"))
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(subcommand.setName("waitlist").setDescription("View the waitlist"))
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("match")
      .setDescription("Match reporting and player match flow")
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand
            .setName("view")
            .setDescription("View your current match or a specific match")
        ).addStringOption(stringOption("match_id", "Specific match ID"))
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand
            .setName("report")
            .setDescription("Report a match result")
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
        )
          .addIntegerOption(intOption("winner_score", "Winner score for score-based reports", { minValue: 0, maxValue: 99 }))
          .addIntegerOption(intOption("loser_score", "Loser score for score-based reports", { minValue: 0, maxValue: 99 }))
          .addStringOption(stringOption("reason", "Optional context for no-show, walkover, or issues"))
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand
            .setName("confirm")
            .setDescription("Confirm a pending result report")
            .addStringOption(stringOption("report_id", "Result report ID", true))
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          addRequiredReasonOption(
            subcommand
              .setName("dispute")
              .setDescription("Dispute a pending result report")
              .addStringOption(stringOption("report_id", "Result report ID", true)),
            "Reason for disputing the result"
          )
        )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("bracket")
      .setDescription("Bracket and tournament overview")
      .addSubcommand((subcommand) =>
        addTournamentIdOption(subcommand.setName("view").setDescription("View a tournament overview"))
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand
            .setName("round")
            .setDescription("View a specific round")
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
            .addIntegerOption(
              intOption("round_number", "Round number", {
                minValue: 1,
                maxValue: 32,
                required: true
              })
            )
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand
            .setName("match")
            .setDescription("View detailed match information")
            .addStringOption(stringOption("match_id", "Match ID", true))
        )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("staff")
      .setDescription("Staff tools and moderation actions")
      .addSubcommand((subcommand) =>
        addTournamentIdOption(subcommand.setName("panel").setDescription("Open the staff control panel"))
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          addRequiredReasonOption(
            subcommand
              .setName("advance")
              .setDescription("Force-advance a match")
              .addStringOption(stringOption("match_id", "Match ID", true))
              .addStringOption(stringOption("winner_id", "Winner registration or entrant ID", true)),
            "Reason for forcing the result"
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
              .setDescription("Drop a participant from the tournament")
              .addUserOption(userOption("user", "Participant to drop", true)),
            "Reason for dropping the participant"
          )
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          addRequiredReasonOption(
            subcommand
              .setName("forcejoin")
              .setDescription("Force add a participant to registration")
              .addUserOption(userOption("user", "User to add", true)),
            "Reason for force-joining the user"
          )
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          addRequiredReasonOption(
            subcommand
              .setName("remove")
              .setDescription("Remove a participant from registration or bracket")
              .addUserOption(userOption("user", "User to remove", true)),
            "Reason for removing the user"
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
          addRequiredReasonOption(
            subcommand.setName("remake").setDescription("Rebuild the bracket from current seeds"),
            "Reason for remaking the bracket"
          )
        )
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          subcommand
            .setName("override")
            .setDescription("Override a reported result")
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
            .addStringOption((option) =>
              option
                .setName("reason")
                .setDescription("Reason for the override")
                .setRequired(true)
                .setMaxLength(250)
            )
        )
          .addIntegerOption(intOption("winner_score", "Winner score for score-based overrides", { minValue: 0, maxValue: 99 }))
          .addIntegerOption(intOption("loser_score", "Loser score for score-based overrides", { minValue: 0, maxValue: 99 }))
      )
      .addSubcommand((subcommand) =>
        addTournamentIdOption(
          addRequiredReasonOption(
            subcommand.setName("undo").setDescription("Undo the most recent reversible staff action"),
            "Reason for the undo"
          )
        )
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
