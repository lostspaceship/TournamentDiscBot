import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const tourCommandDefinition = new SlashCommandBuilder()
  .setName("tour")
  .setDescription("Manage the tournament")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a tournament")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel for the live tournament post")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("config").setDescription("Update config")
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
      .addStringOption((option) =>
        option.setName("mutual_exclusion_key").setDescription("Mutual exclusion bucket")
      )
      .addBooleanOption((option) =>
        option.setName("require_opponent_confirmation").setDescription("Require opponent confirmation")
      )
      .addBooleanOption((option) =>
        option.setName("grand_finals_reset").setDescription("Enable grand finals reset")
      )
      .addBooleanOption((option) =>
        option.setName("allow_withdrawals").setDescription("Allow player withdrawals before start")
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("open").setDescription("Open registration")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("start").setDescription("Start the tournament")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("join").setDescription("Join the tournament")
      .addStringOption((option) =>
        option.setName("name").setDescription("Name to show on the bracket").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("league_ign").setDescription("Your League ID, for example test#test").setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("leave").setDescription("Leave the tournament")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("ign")
      .setDescription("Look up a player's IGN")
      .addStringOption((option) =>
        option.setName("name").setDescription("Bracket name").setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("addfake")
      .setDescription("Add fake players")
      .addIntegerOption((option) =>
        option.setName("count").setDescription("How many fake players to add").setRequired(true).setMinValue(1).setMaxValue(64)
      )
      .addStringOption((option) =>
        option.setName("prefix").setDescription("Name prefix")
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("advance")
      .setDescription("Advance a player")
      .addStringOption((option) =>
        option.setName("name").setDescription("Player name").setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("undo")
      .setDescription("Undo the last advance")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("switch")
      .setDescription("Swap two bracket names")
      .addStringOption((option) =>
        option.setName("name_one").setDescription("First player name").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("name_two").setDescription("Second player name").setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("reseed")
      .setDescription("Reseed before start")
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
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("cancel")
      .setDescription("Cancel the tournament")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("finish").setDescription("Finish the tournament")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("rules")
      .setDescription("Update rules")
      .addStringOption((option) =>
        option
          .setName("section")
          .setDescription("Which rules section to update")
          .setRequired(true)
          .addChoices(
            { name: "Mode", value: "MODE" },
            { name: "Win Conditions", value: "WIN_CONDITIONS" },
            { name: "Bans", value: "BANS" },
            { name: "Summoners", value: "SUMMONERS" },
            { name: "Extra Info", value: "EXTRA_INFO" }
          )
      )
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("How to update the section")
          .setRequired(true)
          .addChoices(
            { name: "Add Rule", value: "ADD" },
            { name: "Replace Section", value: "REPLACE" },
            { name: "Clear Section", value: "CLEAR" }
          )
      )
      .addStringOption((option) =>
        option.setName("value").setDescription("Rule text for add or replace")
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
