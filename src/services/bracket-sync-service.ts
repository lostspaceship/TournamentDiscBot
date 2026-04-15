import {
  AttachmentBuilder,
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
import { resolveTournamentBracketSnapshot } from "./support/bracket-snapshot.js";
import type { BracketSyncTarget } from "./support/bracket-sync-target.js";

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
        tournament.bracketMessageChannelId ?? guildConfig.tournamentAnnouncementChannelId ?? null;

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

      const renderModel = this.buildRenderModel(tournament);
      const imageBuffer = this.imageRenderer.renderPng(renderModel);
      const filename = `bracket-${tournament.id}.png`;
      const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
      const embed = new EmbedBuilder()
        .setColor(renderModel.mode === "OFFICIAL" ? 0x2b6ef2 : 0xd29922)
        .setTitle(renderModel.tournamentName)
        .setDescription(
          renderModel.mode === "OFFICIAL"
            ? "Current official bracket."
            : renderModel.mode === "PREVIEW"
              ? "Live bracket preview. Registration is still open until the tournament starts."
              : "Waiting for enough eligible entrants to build a bracket preview."
        )
        .setImage(`attachment://${filename}`)
        .setFooter({ text: renderModel.updatedLabel });

      const payload: MessageCreateOptions & MessageEditOptions = {
        embeds: [embed],
        files: [attachment],
        allowedMentions: { parse: [] }
      };

      const postedMessage = await this.upsertBracketMessage(
        channel,
        tournament.bracketMessageId,
        payload
      );

      await prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          bracketMessageChannelId: targetChannelId,
          bracketMessageId: postedMessage.id,
          bracketImageUpdatedAt: new Date()
        }
      });
    } catch (error) {
      this.logger.error({ error, tournamentId }, "Bracket sync failed");
    }
  }

  private async upsertBracketMessage(
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

  private buildRenderModel(
    tournament: NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>
  ): BracketRenderModel {
    const { snapshot, mode } = resolveTournamentBracketSnapshot(tournament);
    const namesByRegistrationId = new Map(
      tournament.registrations.map((entry) => [entry.id, entry.participant.displayName] as const)
    );
    const rounds: BracketRenderRound[] =
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

    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      status: tournament.status,
      mode,
      updatedLabel: `Updated ${new Date().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short"
      })}`,
      registrationCount: tournament.registrations.filter((entry) => entry.status === "ACTIVE").length,
      rounds
    };
  }
}

const sideOrder = (side: BracketRenderRound["side"]): number => {
  if (side === "WINNERS") return 0;
  if (side === "LOSERS") return 1;
  return 2;
};
