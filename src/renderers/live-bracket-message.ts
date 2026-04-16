import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageCreateOptions,
  type MessageEditOptions
} from "discord.js";

import { buildSignedCustomId } from "../interactions/secure-payload.js";
import type { BracketImageRenderer } from "./bracket-image-renderer.js";
import type { BracketTabKey } from "./bracket-paging.js";
import type { BracketRenderModel } from "./types.js";

export interface LiveBracketPayloadResult {
  payload: MessageCreateOptions & MessageEditOptions;
  state: {
    tab: BracketTabKey;
    page: number;
  };
}

export const buildLiveBracketMessagePayload = (
  tournamentId: string,
  model: BracketRenderModel,
  imageRenderer: BracketImageRenderer
): LiveBracketPayloadResult => {
  const imageBuffer = imageRenderer.renderPng(model);
  const filename = `bracket-${tournamentId}-${model.activeTab.toLowerCase()}-p${model.page}-r${model.registrationCount}-t${Date.now()}.png`;
  const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
  const embed = new EmbedBuilder()
    .setColor(model.mode === "OFFICIAL" ? 0x2b6ef2 : 0xd29922)
    .setImage(`attachment://${filename}`);

  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...model.tabs.map((entry) =>
        new ButtonBuilder()
          .setCustomId(
            buildSignedCustomId(
              "bracket",
              "bt",
              `${tournamentId}|${entry.key}|1`,
              `tab-${entry.key.toLowerCase()}`
            )
          )
          .setLabel(entry.label)
          .setStyle(entry.key === model.activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    )
  ];

  if (model.totalPages > 1) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            buildSignedCustomId(
              "bracket",
              "bp",
              `${tournamentId}|${model.activeTab}|${Math.max(1, model.page - 1)}`,
              `page-prev-${model.page}`
            )
          )
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(model.page <= 1),
        new ButtonBuilder()
          .setCustomId(
            buildSignedCustomId(
              "bracket",
              "bn",
              `${tournamentId}|${model.activeTab}|${Math.min(model.totalPages, model.page + 1)}`,
              `page-next-${model.page}`
            )
          )
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(model.page >= model.totalPages)
      )
    );
  }

  return {
    payload: {
      embeds: [embed],
      files: [attachment],
      components,
      allowedMentions: { parse: [] }
    },
    state: {
      tab: model.activeTab,
      page: model.page
    }
  };
};
