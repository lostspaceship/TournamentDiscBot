import {
  ChannelType,
  Client,
  type MessageCreateOptions,
  type MessageEditOptions,
  type TextBasedChannel
} from "discord.js";
import type pino from "pino";

import { prisma } from "../config/prisma.js";
import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import { BracketImageRenderer } from "../renderers/bracket-image-renderer.js";
import type { BracketTabKey } from "../renderers/bracket-paging.js";
import type { ParticipantsPageView } from "./viewing-service.js";
import { buildLiveBracketRenderModel } from "../renderers/live-bracket-model.js";
import { buildLiveBracketMessagePayload } from "../renderers/live-bracket-message.js";
import type { BracketSyncTarget } from "./support/bracket-sync-target.js";
import {
  buildOverviewEmbed,
  buildOverviewWithParticipantsComponents,
  buildParticipantsEmbed
} from "../utils/tournament-view-ui.js";

export class BracketSyncService implements BracketSyncTarget {
  public constructor(
    private readonly client: Client,
    private readonly logger: pino.Logger,
    private readonly tournamentRepository: TournamentRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly imageRenderer: BracketImageRenderer
  ) {}

  public async syncTournamentBracket(tournamentId: string): Promise<void> {
    try {
      const tournament = await this.tournamentRepository.getTournament(tournamentId);
      if (!tournament) {
        return;
      }

      const guildConfig = await this.guildConfigRepository.getOrCreate(tournament.guildId);
      const targetChannelId =
        tournament.infoMessageChannelId ??
        tournament.bracketMessageChannelId ??
        guildConfig.tournamentAnnouncementChannelId ??
        null;

      if (!targetChannelId) {
        return;
      }

      const channel = await this.client.channels.fetch(targetChannelId);
      if (
        !channel ||
        !channel.isTextBased() ||
        channel.type === ChannelType.DM ||
        !("messages" in channel) ||
        !channel.isSendable()
      ) {
        this.logger.warn({ tournamentId, channelId: targetChannelId }, "Bracket sync skipped because the configured channel is not text-based");
        return;
      }

      const participantsPage = this.buildParticipantsPage(tournament, 1);
      const overviewEmbed = buildOverviewEmbed({
        id: tournament.id,
        name: tournament.name,
        status: tournament.status,
        format: tournament.format,
        bestOf: tournament.bestOfDefault,
        activeCount: participantsPage.totalCount,
        seedingMethod: tournament.settings?.seedingMethod ?? "RANDOM"
      });
      const infoPayload: MessageCreateOptions & MessageEditOptions = {
        embeds: [overviewEmbed, buildParticipantsEmbed(participantsPage, "Registered Players", false)],
        components: buildOverviewWithParticipantsComponents(
          participantsPage.tournamentId,
          participantsPage.page,
          participantsPage.totalPages
        ),
        allowedMentions: { parse: [] }
      };

      const { payload, state } = this.buildBracketPayload(
        tournament,
        this.resolveStoredTab(tournament.bracketViewTab),
        tournament.bracketViewPage
      );

      const infoMessage = await this.upsertTrackedMessage(
        channel,
        tournament.infoMessageId,
        infoPayload
      );
      const postedMessage = await this.upsertBracketMessage(
        channel,
        tournament.bracketMessageId,
        payload
      );

      await prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          infoMessageChannelId: targetChannelId,
          infoMessageId: infoMessage.id,
          bracketMessageChannelId: targetChannelId,
          bracketMessageId: postedMessage.id,
          bracketViewTab: state.tab,
          bracketViewPage: state.page,
          bracketImageUpdatedAt: new Date()
        }
      });
    } catch (error) {
      this.logger.error({ error, tournamentId }, "Bracket sync failed");
    }
  }

  public async buildBracketMessagePayload(
    tournamentId: string,
    tab: BracketTabKey = "WINNERS",
    page = 1,
    options?: {
      persistState?: boolean;
    }
  ) {
    const tournament = await this.tournamentRepository.getTournament(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found.");
    }

    const { payload, state } = this.buildBracketPayload(tournament, tab, page);
    if (options?.persistState !== false) {
      await this.tournamentRepository.updateBracketViewState(tournamentId, state);
    }

    return payload;
  }

  private async upsertBracketMessage(
    channel: TextBasedChannel & { messages: { fetch(messageId: string): Promise<{ edit(options: MessageEditOptions): Promise<{ id: string }> }> }; send(options: MessageCreateOptions): Promise<{ id: string }> },
    existingMessageId: string | null,
    payload: MessageCreateOptions & MessageEditOptions
  ) {
    return this.upsertTrackedMessage(channel, existingMessageId, payload);
  }

  private async upsertTrackedMessage(
    channel: TextBasedChannel & { messages: { fetch(messageId: string): Promise<{ edit(options: MessageEditOptions): Promise<{ id: string }> }> }; send(options: MessageCreateOptions): Promise<{ id: string }> },
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
        // fall through to repost when the tracked message no longer exists
      }
    }

    return await channel.send(payload);
  }

  private buildParticipantsPage(
    tournament: NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>,
    page: number,
    pageSize = 10
  ): ParticipantsPageView {
    const ordered = tournament.registrations
      .filter((entry) => entry.status === "ACTIVE")
      .sort((left, right) => {
      const leftSeed = left.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
      const rightSeed = right.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftSeed !== rightSeed) return leftSeed - rightSeed;
      return left.joinedAt.getTime() - right.joinedAt.getTime();
      });
    const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (safePage - 1) * pageSize;

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      page: safePage,
      totalPages,
      totalCount: ordered.length,
      entries: ordered.slice(startIndex, startIndex + pageSize).map((entry) => ({
        registrationId: entry.id,
        displayName: entry.participant.displayName,
        discordUserId: entry.participant.discordUserId,
        leagueIgn: entry.participant.opggProfile ?? null,
        seed: entry.seed?.seedNumber ?? null,
        status: entry.status,
        checkedIn: entry.checkIn != null,
        placement: entry.placement ?? null
      }))
    };
  }

  private buildBracketPayload(
    tournament: NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>,
    tab: BracketTabKey,
    page: number
  ): {
    payload: MessageCreateOptions & MessageEditOptions;
    state: {
      tab: BracketTabKey;
      page: number;
    };
  } {
    const renderModel = buildLiveBracketRenderModel(tournament, tab, page);
    return buildLiveBracketMessagePayload(tournament.id, renderModel, this.imageRenderer);
  }

  private resolveStoredTab(value: string): BracketTabKey {
    if (value === "LOSERS" || value === "FINALS" || value === "PLACEMENTS") {
      return value;
    }

    return "WINNERS";
  }

}
