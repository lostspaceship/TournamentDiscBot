import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const rulesCommandDefinition = new SlashCommandBuilder()
  .setName("rules")
  .setDescription("Post a server rules section")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a server rules post")
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Rules text to show in the post")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Embed title")
      )
      .addStringOption((option) =>
        option
          .setName("hero_image_url")
          .setDescription("Hero image URL to show under the rules text")
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post the rules section")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
