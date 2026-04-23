import {
  ChannelType,
  Client,
  EmbedBuilder,
  type MessageCreateOptions,
  type MessageEditOptions,
  type TextBasedChannel
} from "discord.js";

import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { TwitchApiService } from "./twitch-api-service.js";
import { YouTubeFeedService } from "./youtube-feed-service.js";
import { ValidationError } from "../utils/errors.js";
import {
  buildNotificationRoleComponents,
  buildNotificationRoleEmbed
} from "../utils/alert-ui.js";

interface SetTwitchAlertInput {
  guildId: string;
  channelId: string;
  username: string;
  roleId?: string | null;
}

interface SetYouTubeAlertInput {
  guildId: string;
  channelId: string;
  youtubeChannelId: string;
  roleId?: string | null;
}

interface CreateRoleMessageInput {
  guildId: string;
  channelId: string;
  twitchRoleId?: string | null;
  youtubeRoleId?: string | null;
  title: string;
  description: string;
}

export class AlertAdminService {
  public constructor(
    private readonly client: Client,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly twitchApiService: TwitchApiService,
    private readonly youTubeFeedService: YouTubeFeedService
  ) {}

  public async configureTwitchAlert(input: SetTwitchAlertInput) {
    const user = await this.twitchApiService.getUserByLogin(input.username);
    if (!user) {
      throw new ValidationError("Twitch user not found.");
    }

    const stream = await this.twitchApiService.getLiveStreamByUserId(user.id);

    return this.guildConfigRepository.updateConfig(input.guildId, {
      liveAlertsChannelId: input.channelId,
      twitchAlertEnabled: true,
      twitchUsername: user.login,
      twitchUserId: user.id,
      twitchNotificationRoleId: input.roleId ?? null,
      twitchLastStreamId: stream?.id ?? null,
      twitchLastStartedAt: stream?.startedAt ? new Date(stream.startedAt) : null
    });
  }

  public async configureYouTubeAlert(input: SetYouTubeAlertInput) {
    const channelId = this.youTubeFeedService.normalizeChannelId(input.youtubeChannelId);
    const latestVideo = await this.youTubeFeedService.getLatestVideo(channelId);

    return this.guildConfigRepository.updateConfig(input.guildId, {
      liveAlertsChannelId: input.channelId,
      youtubeAlertEnabled: true,
      youtubeChannelId: channelId,
      youtubeNotificationRoleId: input.roleId ?? null,
      youtubeLastVideoId: latestVideo?.videoId ?? null
    });
  }

  public async disableAlerts(guildId: string, platform: "TWITCH" | "YOUTUBE" | "BOTH") {
    return this.guildConfigRepository.updateConfig(guildId, {
      ...(platform === "TWITCH" || platform === "BOTH"
        ? {
            twitchAlertEnabled: false,
            twitchUsername: null,
            twitchUserId: null,
            twitchNotificationRoleId: null,
            twitchLastStreamId: null,
            twitchLastStartedAt: null
          }
        : {}),
      ...(platform === "YOUTUBE" || platform === "BOTH"
        ? {
            youtubeAlertEnabled: false,
            youtubeChannelId: null,
            youtubeNotificationRoleId: null,
            youtubeLastVideoId: null
          }
        : {})
    });
  }

  public async getStatus(guildId: string) {
    return this.guildConfigRepository.getOrCreate(guildId);
  }

  public async postRoleMessage(input: CreateRoleMessageInput) {
    const config = await this.guildConfigRepository.updateConfig(input.guildId, {
      twitchNotificationRoleId: input.twitchRoleId ?? null,
      youtubeNotificationRoleId: input.youtubeRoleId ?? null
    });
    const targetChannel = await this.resolveTargetChannel(input.channelId);

    const payload: MessageCreateOptions & MessageEditOptions = {
      embeds: [buildNotificationRoleEmbed(input.title, input.description)],
      components: buildNotificationRoleComponents({
        guildId: input.guildId,
        twitchRoleId: config.twitchNotificationRoleId,
        youtubeRoleId: config.youtubeNotificationRoleId
      }),
      allowedMentions: { parse: [] }
    };

    const message = await this.upsertTrackedMessage(
      targetChannel,
      config.notificationRoleMessageId,
      payload
    );

    await this.guildConfigRepository.updateConfig(input.guildId, {
      notificationRoleMessageChannelId: input.channelId,
      notificationRoleMessageId: message.id
    });

    return message;
  }

  private async resolveTargetChannel(channelId: string) {
    const channel = await this.client.channels.fetch(channelId);
    if (
      !channel ||
      !channel.isTextBased() ||
      channel.type === ChannelType.DM ||
      !("messages" in channel) ||
      !channel.isSendable()
    ) {
      throw new ValidationError("Pick a text channel I can post to.");
    }

    return channel as TextBasedChannel & {
      messages: {
        fetch(messageId: string): Promise<{ edit(options: MessageEditOptions): Promise<{ id: string }> }>;
      };
      send(options: MessageCreateOptions): Promise<{ id: string }>;
    };
  }

  private async upsertTrackedMessage(
    channel: TextBasedChannel & {
      messages: {
        fetch(messageId: string): Promise<{ edit(options: MessageEditOptions): Promise<{ id: string }> }>;
      };
      send(options: MessageCreateOptions): Promise<{ id: string }>;
    },
    existingMessageId: string | null,
    payload: MessageCreateOptions & MessageEditOptions
  ) {
    if (existingMessageId) {
      try {
        const existingMessage = await channel.messages.fetch(existingMessageId);
        return await existingMessage.edit({
          ...payload,
          attachments: []
        });
      } catch {
        // repost if missing
      }
    }

    return channel.send(payload);
  }
}
