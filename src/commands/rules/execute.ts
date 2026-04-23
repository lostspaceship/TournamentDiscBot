import {
  ChannelType,
  EmbedBuilder,
  GuildMember,
  type ChatInputCommandInteraction
} from "discord.js";
import pkg from "@prisma/client";

import type { BootstrapContext } from "../../bootstrap/types.js";
import { serverRulesCreateCommandSchema } from "../../validators/command-schemas.js";
import { sanitizeUserText } from "../../utils/sanitize.js";
import { replyWithError } from "../tour/helpers.js";

const { StaffRoleType } = pkg;

const formatRulesText = (input: string): string => {
  const normalized = input.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").trim();
  const sourceLines = normalized.includes("\n")
    ? normalized.split("\n")
    : normalized.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);

  return sourceLines
    .map((line) => sanitizeUserText(line, 500).trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith("- ") ? line : `- ${line.replace(/^-+\s*/, "")}`))
    .join("\n");
};

export const executeRulesCommand = async (
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

    await context.permissionService.requireMinimumRole(
      interaction.guildId,
      interaction.member,
      StaffRoleType.ADMIN,
      "command.rules.create"
    );

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand !== "create") {
      await interaction.reply({ content: "That command isn't available.", ephemeral: true });
      return;
    }

    const parsed = serverRulesCreateCommandSchema.parse({
      title: interaction.options.getString("title") ?? undefined,
      text: interaction.options.getString("text", true),
      heroImageUrl: interaction.options.getString("hero_image_url") ?? undefined
    });

    const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (
      !targetChannel ||
      !("send" in targetChannel) ||
      typeof targetChannel.send !== "function" ||
      ("isSendable" in targetChannel && typeof targetChannel.isSendable === "function" && !targetChannel.isSendable()) ||
      ("type" in targetChannel && targetChannel.type === ChannelType.DM)
    ) {
      await interaction.reply({ content: "Pick a text channel I can post to.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xc23b22)
      .setTitle(sanitizeUserText(parsed.title, 80))
      .setDescription(formatRulesText(parsed.text));

    if (parsed.heroImageUrl) {
      embed.setImage(parsed.heroImageUrl);
    }

    await targetChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });

    await interaction.reply({
      content: `Posted the rules section in <#${targetChannel.id}>.`,
      ephemeral: true
    });
  } catch (error) {
    await replyWithError(interaction, error);
  }
};
