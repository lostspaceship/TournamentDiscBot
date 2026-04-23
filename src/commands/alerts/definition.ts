import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const alertsCommandDefinition = new SlashCommandBuilder()
  .setName("alerts")
  .setDescription("Manage Twitch and YouTube alerts")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("twitch")
      .setDescription("Configure Twitch live alerts")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where Twitch alerts should be posted")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addStringOption((option) =>
        option
          .setName("username")
          .setDescription("Twitch username")
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Role to mention for Twitch alerts")
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("youtube")
      .setDescription("Configure YouTube upload alerts")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where YouTube alerts should be posted")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addStringOption((option) =>
        option
          .setName("channel_id")
          .setDescription("YouTube channel ID or channel URL")
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Role to mention for YouTube alerts")
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("roles")
      .setDescription("Create or update the self-assign alert role message")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post the role selector")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addRoleOption((option) =>
        option
          .setName("twitch_role")
          .setDescription("Role for Twitch notifications")
      )
      .addRoleOption((option) =>
        option
          .setName("youtube_role")
          .setDescription("Role for YouTube notifications")
      )
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Embed title")
      )
      .addStringOption((option) =>
        option
          .setName("description")
          .setDescription("Embed description")
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("disable")
      .setDescription("Disable alerts")
      .addStringOption((option) =>
        option
          .setName("platform")
          .setDescription("Which alerts to disable")
          .setRequired(true)
          .addChoices(
            { name: "Twitch", value: "TWITCH" },
            { name: "YouTube", value: "YOUTUBE" },
            { name: "Both", value: "BOTH" }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Show current alert configuration")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
