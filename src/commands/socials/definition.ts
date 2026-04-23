import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const socialsCommandDefinition = new SlashCommandBuilder()
  .setName("socials")
  .setDescription("Post a server socials section")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a server socials post")
      .addStringOption((option) =>
        option
          .setName("links")
          .setDescription("One social per line: Name - URL or Name - Label=URL | Label=URL")
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
          .setDescription("Hero image URL to show under the social links")
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post the socials section")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
