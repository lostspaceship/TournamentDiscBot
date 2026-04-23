import {
  ChannelType,
  EmbedBuilder,
  GuildMember,
  type ChatInputCommandInteraction
} from "discord.js";
import pkg from "@prisma/client";

import type { BootstrapContext } from "../../bootstrap/types.js";
import { serverSocialsCreateCommandSchema } from "../../validators/command-schemas.js";
import { sanitizeUserText } from "../../utils/sanitize.js";
import { parseInput, replyWithError } from "../tour/helpers.js";

const { StaffRoleType } = pkg;

interface SocialEntry {
  label: string;
  url: string;
}

const splitSocialEntries = (input: string): string[] =>
  input
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .split(/\n|,\s+(?=[^,\n]+?\s*-\s*https?:\/\/)/i)
    .map((line) => sanitizeUserText(line, 500).trim())
    .filter((line) => line.length > 0);

const parseSimpleEntry = (line: string): SocialEntry | null => {
  const match = line.match(/^\s*(.+?)\s*-\s*(https?:\/\/\S+)\s*$/i);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return {
    label: match[1].trim(),
    url: match[2].trim()
  };
};

const resolveTikTokLabel = (label: string): string => {
  const stripped = label.replace(/tiktok/gi, "").replace(/\s+/g, " ").trim();
  if (!stripped) {
    return "Main";
  }

  return stripped
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatSocialLinks = (input: string): string => {
  const lines = splitSocialEntries(input);
  const formattedLines: string[] = [];
  const tiktokLinks: string[] = [];

  lines
    .map((line) => {
      const groupedMatch = line.match(/^\s*(.+?)\s*-\s*(.+)$/i);
      if (groupedMatch) {
        const platform = groupedMatch[1]?.trim();
        const remainder = groupedMatch[2]?.trim();
        if (!platform || !remainder) {
          return `- ${line}`;
        }

        const groupedLinks = remainder
          .split("|")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
          .map((part) => {
            const pairMatch = part.match(/^(.+?)\s*=\s*(https?:\/\/\S+)$/i);
            if (!pairMatch) {
              return null;
            }

            const label = pairMatch[1]?.trim();
            const url = pairMatch[2]?.trim();
            if (!label || !url) {
              return null;
            }

            return `[${label}](${url})`;
          })
          .filter((part): part is string => part != null);

        if (groupedLinks.length > 0) {
          if (platform.toLowerCase().includes("tiktok")) {
            tiktokLinks.push(...groupedLinks);
            return null;
          }

          return `- ${platform}: ${groupedLinks.join(" | ")}`;
        }
      }

      const entry = parseSimpleEntry(line);
      if (!entry) {
        return `- ${line}`;
      }

      if (entry.label.toLowerCase().includes("tiktok")) {
        tiktokLinks.push(`[${resolveTikTokLabel(entry.label)}](${entry.url})`);
        return null;
      }

      return `- [${entry.label}](${entry.url})`;
    })
    .filter((line): line is string => line != null)
    .forEach((line) => {
      formattedLines.push(line);
    });

  if (tiktokLinks.length > 0) {
    formattedLines.push(`- TikTok: ${tiktokLinks.join(" | ")}`);
  }

  return formattedLines
    .join("\n");
};

export const executeSocialsCommand = async (
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
      "command.socials.create"
    );

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand !== "create") {
      await interaction.reply({ content: "That command isn't available.", ephemeral: true });
      return;
    }

    const parsed = parseInput(serverSocialsCreateCommandSchema, {
      title: interaction.options.getString("title") ?? undefined,
      links: interaction.options.getString("links", true),
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
      .setColor(0x1da1f2)
      .setTitle(sanitizeUserText(parsed.title ?? "Social Links", 80))
      .setDescription(formatSocialLinks(parsed.links));

    if (parsed.heroImageUrl) {
      embed.setImage(parsed.heroImageUrl);
    }

    await targetChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });

    const targetChannelId =
      "id" in targetChannel && typeof targetChannel.id === "string"
        ? targetChannel.id
        : interaction.channelId;

    await interaction.reply({
      content: targetChannelId
        ? `Posted the socials section in <#${targetChannelId}>.`
        : "Posted the socials section.",
      ephemeral: true
    });
  } catch (error) {
    await replyWithError(interaction, error);
  }
};
