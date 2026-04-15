import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  type MessageCreateOptions,
  type MessageEditOptions,
  type TextBasedChannel
} from "discord.js";
import type pino from "pino";

import { prisma } from "../config/prisma.js";
import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import { BracketImageRenderer } from "../renderers/bracket-image-renderer.js";
import type { BracketRenderModel, BracketRenderRound } from "../renderers/types.js";
import type { ParticipantsPageView } from "./viewing-service.js";
import { buildSignedCustomId } from "../interactions/secure-payload.js";
import { resolveTournamentBracketSnapshot } from "./support/bracket-snapshot.js";
import type { BracketSyncTarget } from "./support/bracket-sync-target.js";
import {
  buildOverviewEmbed,
  buildOverviewWithParticipantsComponents,
  buildParticipantsEmbed
} from "../utils/tournament-view-ui.js";

export class BracketSyncService implements BracketSyncTarget {
  private static readonly ROUNDS_PER_PAGE = 3;

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

      const payload = this.buildBracketPayload(tournament, 1);

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
          bracketImageUpdatedAt: new Date()
        }
      });
    } catch (error) {
      this.logger.error({ error, tournamentId }, "Bracket sync failed");
    }
  }

  public async buildBracketMessagePayload(tournamentId: string, page: number) {
    const tournament = await this.tournamentRepository.getTournament(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found.");
    }

    return this.buildBracketPayload(tournament, page);
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

  private buildRenderModel(
    tournament: NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>,
    page: number
  ): BracketRenderModel {
    const activeRegistrations = tournament.registrations
      .filter((entry) => entry.status === "ACTIVE")
      .sort((left, right) => {
        const leftSeed = left.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
        const rightSeed = right.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
        if (leftSeed !== rightSeed) return leftSeed - rightSeed;
        return left.joinedAt.getTime() - right.joinedAt.getTime();
      });
    const { snapshot, mode } = resolveTournamentBracketSnapshot(tournament);
    const namesByRegistrationId = new Map(
      tournament.registrations.map((entry) => [entry.id, entry.participant.displayName] as const)
    );
    const allRounds: BracketRenderRound[] =
      snapshot?.rounds
        .map((round) => ({
          id: round.id,
          side: round.side,
          roundNumber: round.roundNumber,
          name: round.name,
          matches: round.matchIds.map((matchId) => {
            const match = snapshot.matches[matchId]!;
            return {
              id: match.id,
              side: match.side,
              roundNumber: match.roundNumber,
              sequence: match.sequence,
              status: match.status,
              player1Name: namesByRegistrationId.get(match.slots[0].entrantId ?? "") ?? "BYE / TBD",
              player2Name: namesByRegistrationId.get(match.slots[1].entrantId ?? "") ?? "BYE / TBD",
              winnerName: namesByRegistrationId.get(match.winnerId ?? "") ?? null,
              nextMatchId: match.nextMatchId
            };
          })
        }))
        .sort(
          (left, right) =>
            sideOrder(left.side) - sideOrder(right.side) || left.roundNumber - right.roundNumber
        ) ?? [];
    const pages =
      allRounds.length > 0
        ? this.paginateRounds(allRounds)
        : this.buildPlaceholderPages(activeRegistrations);
    const safePage = Math.min(Math.max(1, page), Math.max(1, pages.length));
    const selectedPage =
      pages[safePage - 1] ??
      this.buildPlaceholderPages(activeRegistrations)[0]!;

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      status: tournament.status,
      mode,
      updatedLabel: `Updated ${new Date().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short"
      })}`,
      page: safePage,
      totalPages: Math.max(1, pages.length),
      pageLabel: selectedPage.label,
      registrationCount: activeRegistrations.length,
      rounds: selectedPage.rounds,
      placeholder: selectedPage.placeholder
    };
  }

  private buildBracketPayload(
    tournament: NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>,
    page: number
  ): MessageCreateOptions & MessageEditOptions {
    const renderModel = this.buildRenderModel(tournament, page);
    const imageBuffer = this.imageRenderer.renderPng(renderModel);
    const filename = `bracket-${tournament.id}-p${renderModel.page}-r${renderModel.registrationCount}-t${Date.now()}.png`;
    const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
    const embed = new EmbedBuilder()
      .setColor(renderModel.mode === "OFFICIAL" ? 0x2b6ef2 : 0xd29922)
      .setImage(`attachment://${filename}`);

    const components =
      renderModel.totalPages > 1
        ? [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(
                  buildSignedCustomId(
                    "bracket",
                    "bp",
                    `${tournament.id}|${Math.max(1, renderModel.page - 1)}`,
                    `bp${renderModel.page}`
                  )
                )
                .setLabel("Previous")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(renderModel.page <= 1),
              new ButtonBuilder()
                .setCustomId(
                  buildSignedCustomId(
                    "bracket",
                    "bn",
                    `${tournament.id}|${Math.min(renderModel.totalPages, renderModel.page + 1)}`,
                    `bn${renderModel.page}`
                  )
                )
                .setLabel("Next")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(renderModel.page >= renderModel.totalPages)
            )
          ]
        : [];

    return {
      embeds: [embed],
      files: [attachment],
      components,
      allowedMentions: { parse: [] }
    };
  }

  private paginateRounds(rounds: BracketRenderRound[]) {
    if (rounds.length === 0) {
      return [
        {
          label: "Bracket Preview",
          rounds: [] as BracketRenderRound[],
          placeholder: undefined as BracketRenderModel["placeholder"]
        }
      ];
    }

    const pages: Array<{
      label: string;
      rounds: BracketRenderRound[];
      placeholder: BracketRenderModel["placeholder"];
    }> = [];
    const bySide = [
      { side: "WINNERS", title: "Winners Bracket" },
      { side: "LOSERS", title: "Losers Bracket" },
      { side: "GRAND_FINALS", title: "Grand Finals" }
    ] as const;

    for (const group of bySide) {
      const sideRounds = rounds.filter((round) => round.side === group.side);
      for (let index = 0; index < sideRounds.length; index += 3) {
        const chunk = sideRounds.slice(index, index + 3);
        const startRound = chunk[0]?.roundNumber ?? 1;
        const endRound = chunk[chunk.length - 1]?.roundNumber ?? startRound;
        pages.push({
          label:
            startRound === endRound
              ? `${group.title} - Round ${startRound}`
              : `${group.title} - Rounds ${startRound}-${endRound}`,
          rounds: chunk,
          placeholder: undefined
        });
      }
    }

    return pages;
  }

  private buildPlaceholderPages(
    activeRegistrations: Array<
      NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>["registrations"][number]
    >
  ) {
    const registrationCount = activeRegistrations.length;
    const bracketSize = projectedBracketSize(registrationCount);
    const entrantNames = activeRegistrations.map((entry) => entry.participant.displayName);
    const totalRounds = Math.max(1, Math.ceil(Math.log2(bracketSize)));
    const pages: Array<{
      label: string;
      rounds: BracketRenderRound[];
      placeholder: BracketRenderModel["placeholder"];
    }> = [];

    for (
      let startRound = 1;
      startRound <= totalRounds;
      startRound += BracketSyncService.ROUNDS_PER_PAGE
    ) {
      const endRound = Math.min(
        totalRounds,
        startRound + BracketSyncService.ROUNDS_PER_PAGE - 1
      );
      pages.push({
        label:
          startRound === endRound
            ? `Bracket Preview - Round ${startRound}`
            : `Bracket Preview - Rounds ${startRound}-${endRound}`,
        rounds: [],
        placeholder: {
          bracketSize,
          startRound,
          endRound,
          totalRounds,
          entrantNames
        }
      });
    }

    return pages;
  }
}

const sideOrder = (side: BracketRenderRound["side"]): number => {
  if (side === "WINNERS") return 0;
  if (side === "LOSERS") return 1;
  return 2;
};

const projectedBracketSize = (registrationCount: number): number => {
  const minimumSize = 16;
  const desiredSize = Math.max(minimumSize, registrationCount <= 1 ? 2 : registrationCount);
  let size = 1;
  while (size < desiredSize) {
    size *= 2;
  }

  return size;
};
