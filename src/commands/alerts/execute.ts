import { GuildMember, type ChatInputCommandInteraction } from "discord.js";
import pkg from "@prisma/client";

import type { BootstrapContext } from "../../bootstrap/types.js";
import {
  alertsDisableCommandSchema,
  alertsRoleMessageCommandSchema,
  alertsTwitchCommandSchema,
  alertsYouTubeCommandSchema
} from "../../validators/command-schemas.js";
import { parseInput, replyWithError } from "../tour/helpers.js";

const { StaffRoleType } = pkg;

export const executeAlertsCommand = async (
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
      "command.alerts"
    );

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "twitch") {
      const parsed = parseInput(alertsTwitchCommandSchema, {
        channelId: interaction.options.getChannel("channel", true).id,
        username: interaction.options.getString("username", true),
        roleId: interaction.options.getRole("role")?.id ?? undefined
      });
      const config = await context.alertAdminService.configureTwitchAlert({
        guildId: interaction.guildId,
        channelId: parsed.channelId,
        username: parsed.username,
        roleId: parsed.roleId
      });
      await interaction.reply({
        content: `Twitch alerts enabled for ${config.twitchUsername} in <#${parsed.channelId}>.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "youtube") {
      const parsed = parseInput(alertsYouTubeCommandSchema, {
        channelId: interaction.options.getChannel("channel", true).id,
        youtubeChannelId: interaction.options.getString("channel_id", true),
        roleId: interaction.options.getRole("role")?.id ?? undefined
      });
      const config = await context.alertAdminService.configureYouTubeAlert({
        guildId: interaction.guildId,
        channelId: parsed.channelId,
        youtubeChannelId: parsed.youtubeChannelId,
        roleId: parsed.roleId
      });
      await interaction.reply({
        content: `YouTube alerts enabled for ${config.youtubeChannelId} in <#${parsed.channelId}>.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "roles") {
      const parsed = parseInput(alertsRoleMessageCommandSchema, {
        channelId: interaction.options.getChannel("channel", true).id,
        twitchRoleId: interaction.options.getRole("twitch_role")?.id ?? undefined,
        youtubeRoleId: interaction.options.getRole("youtube_role")?.id ?? undefined,
        title: interaction.options.getString("title") ?? undefined,
        description: interaction.options.getString("description") ?? undefined
      });
      const message = await context.alertAdminService.postRoleMessage({
        guildId: interaction.guildId,
        channelId: parsed.channelId,
        twitchRoleId: parsed.twitchRoleId,
        youtubeRoleId: parsed.youtubeRoleId,
        title: parsed.title ?? "Notification Roles",
        description: parsed.description ?? "Choose which notifications you want to receive."
      });
      await interaction.reply({
        content: `Alert role message is ready in <#${parsed.channelId}> (${message.id}).`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "disable") {
      const parsed = parseInput(alertsDisableCommandSchema, {
        platform: interaction.options.getString("platform", true)
      });
      await context.alertAdminService.disableAlerts(interaction.guildId, parsed.platform);
      await interaction.reply({
        content: `${parsed.platform === "BOTH" ? "All alerts" : `${parsed.platform} alerts`} disabled.`,
        ephemeral: true
      });
      return;
    }

    const config = await context.alertAdminService.getStatus(interaction.guildId);
    await interaction.reply({
      content: [
        `Alerts channel: ${config.liveAlertsChannelId ? `<#${config.liveAlertsChannelId}>` : "Not set"}`,
        `Twitch: ${config.twitchAlertEnabled ? `${config.twitchUsername ?? "configured"}${config.twitchNotificationRoleId ? ` | role <@&${config.twitchNotificationRoleId}>` : ""}` : "Disabled"}`,
        `YouTube: ${config.youtubeAlertEnabled ? `${config.youtubeChannelId ?? "configured"}${config.youtubeNotificationRoleId ? ` | role <@&${config.youtubeNotificationRoleId}>` : ""}` : "Disabled"}`,
        `Role message: ${config.notificationRoleMessageChannelId ? `<#${config.notificationRoleMessageChannelId}>` : "Not set"}`
      ].join("\n"),
      ephemeral: true,
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    await replyWithError(interaction, error);
  }
};
