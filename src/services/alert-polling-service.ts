import {
  ChannelType,
  Client,
  EmbedBuilder,
  type MessageCreateOptions,
  type TextBasedChannel
} from "discord.js";
import type pino from "pino";

import { env } from "../config/env.js";
import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { TwitchApiService } from "./twitch-api-service.js";
import { YouTubeFeedService } from "./youtube-feed-service.js";

export class AlertPollingService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly client: Client,
    private readonly logger: pino.Logger,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly twitchApiService: TwitchApiService,
    private readonly youTubeFeedService: YouTubeFeedService
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, env.ALERT_POLL_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const configs = await this.guildConfigRepository.listConfigsWithAlerts();
      for (const config of configs) {
        await this.processConfig(config);
      }
    } catch (error) {
      this.logger.error({ error }, "Alert polling tick failed");
    } finally {
      this.running = false;
    }
  }

  private async processConfig(config: Awaited<ReturnType<GuildConfigRepository["getOrCreate"]>>) {
    if (!config.liveAlertsChannelId) {
      return;
    }

    const channel = await this.resolveTargetChannel(config.liveAlertsChannelId);
    if (!channel) {
      return;
    }

    if (config.twitchAlertEnabled && config.twitchUserId && this.twitchApiService.isConfigured()) {
      await this.processTwitch(config, channel);
    }

    if (config.youtubeAlertEnabled && config.youtubeChannelId) {
      await this.processYouTube(config, channel);
    }
  }

  private async processTwitch(
    config: Awaited<ReturnType<GuildConfigRepository["getOrCreate"]>>,
    channel: TextBasedChannel & { send(options: MessageCreateOptions): Promise<unknown> }
  ) {
    try {
      const stream = await this.twitchApiService.getLiveStreamByUserId(config.twitchUserId!);
      if (!stream) {
        if (config.twitchLastStreamId) {
          await this.guildConfigRepository.updateConfig(config.guildId, {
            twitchLastStreamId: null
          });
        }
        return;
      }

      if (config.twitchLastStreamId === stream.id) {
        return;
      }

      await channel.send({
        content: config.twitchNotificationRoleId ? `<@&${config.twitchNotificationRoleId}>` : undefined,
        allowedMentions: config.twitchNotificationRoleId
          ? { roles: [config.twitchNotificationRoleId] }
          : { parse: [] },
        embeds: [
          new EmbedBuilder()
            .setColor(0x9146ff)
            .setTitle(`${stream.userName} is live on Twitch`)
            .setDescription(stream.title)
            .setURL(`https://www.twitch.tv/${stream.userLogin}`)
            .addFields(
              { name: "Category", value: stream.gameName || "Unknown", inline: true },
              { name: "Viewers", value: String(stream.viewerCount), inline: true }
            )
            .setImage(stream.thumbnailUrl.replace("{width}", "1280").replace("{height}", "720"))
            .setTimestamp(new Date(stream.startedAt))
        ]
      });

      await this.guildConfigRepository.updateConfig(config.guildId, {
        twitchLastStreamId: stream.id,
        twitchLastStartedAt: new Date(stream.startedAt)
      });
    } catch (error) {
      this.logger.warn({ error, guildId: config.guildId }, "Twitch alert polling failed");
    }
  }

  private async processYouTube(
    config: Awaited<ReturnType<GuildConfigRepository["getOrCreate"]>>,
    channel: TextBasedChannel & { send(options: MessageCreateOptions): Promise<unknown> }
  ) {
    try {
      const video = await this.youTubeFeedService.getLatestVideo(config.youtubeChannelId!);
      if (!video || config.youtubeLastVideoId === video.videoId) {
        return;
      }

      await channel.send({
        content: config.youtubeNotificationRoleId ? `<@&${config.youtubeNotificationRoleId}>` : undefined,
        allowedMentions: config.youtubeNotificationRoleId
          ? { roles: [config.youtubeNotificationRoleId] }
          : { parse: [] },
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("New YouTube upload")
            .setDescription(video.title)
            .setURL(video.url)
            .addFields({ name: "Channel", value: video.channelId, inline: false })
            .setTimestamp(new Date(video.publishedAt))
        ]
      });

      await this.guildConfigRepository.updateConfig(config.guildId, {
        youtubeLastVideoId: video.videoId
      });
    } catch (error) {
      this.logger.warn({ error, guildId: config.guildId }, "YouTube alert polling failed");
    }
  }

  private async resolveTargetChannel(channelId: string) {
    const channel = await this.client.channels.fetch(channelId);
    if (
      !channel ||
      !channel.isTextBased() ||
      channel.type === ChannelType.DM ||
      !channel.isSendable()
    ) {
      return null;
    }

    return channel as TextBasedChannel & {
      send(options: MessageCreateOptions): Promise<unknown>;
    };
  }
}
