import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";

import { buildSignedCustomId } from "../interactions/secure-payload.js";

export interface NotificationRoleButtonsConfig {
  guildId: string;
  twitchRoleId: string | null;
  youtubeRoleId: string | null;
}

export const buildNotificationRoleEmbed = (
  title: string,
  description: string
): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description);

export const buildNotificationRoleComponents = (
  config: NotificationRoleButtonsConfig
) => {
  const buttons: ButtonBuilder[] = [];

  if (config.twitchRoleId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(
          buildSignedCustomId(
            "alerts",
            "toggle-role",
            `${config.guildId}|TWITCH|${config.twitchRoleId}`,
            "atwitch"
          )
        )
        .setLabel("Twitch Alerts")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (config.youtubeRoleId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(
          buildSignedCustomId(
            "alerts",
            "toggle-role",
            `${config.guildId}|YOUTUBE|${config.youtubeRoleId}`,
            "ayoutub"
          )
        )
        .setLabel("YouTube Alerts")
        .setStyle(ButtonStyle.Danger)
    );
  }

  if (buttons.length === 0) {
    return [];
  }

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
};
