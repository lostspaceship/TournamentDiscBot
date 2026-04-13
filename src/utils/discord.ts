import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  inlineCode
} from "discord.js";

import type { SafeReply } from "../types/bot.js";

export const successReply = (description: string, ephemeral = true): SafeReply => ({
  ephemeral,
  embeds: [
    new EmbedBuilder().setColor(0x2f855a).setDescription(description).setTimestamp()
  ]
});

export const errorReply = (description: string, ephemeral = true): SafeReply => ({
  ephemeral,
  embeds: [
    new EmbedBuilder().setColor(0xc53030).setDescription(description).setTimestamp()
  ]
});

export const tournamentOverviewEmbed = (tournament: any) =>
  new EmbedBuilder()
    .setTitle(tournament.name)
    .setDescription(tournament.description ?? "No description provided.")
    .addFields(
      { name: "Status", value: tournament.status, inline: true },
      { name: "Format", value: tournament.format, inline: true },
      { name: "Capacity", value: `${tournament.registrations?.length ?? 0}/${tournament.maxParticipants}`, inline: true },
      { name: "Best Of", value: String(tournament.bestOfDefault), inline: true },
      { name: "Check-In", value: tournament.requireCheckIn ? "Required" : "Disabled", inline: true },
      { name: "Waitlist", value: tournament.allowWaitlist ? "Enabled" : "Disabled", inline: true }
    )
    .setFooter({ text: `Tournament ID: ${tournament.id}` })
    .setTimestamp(new Date(tournament.updatedAt ?? Date.now()));

export const buildResultActionRow = (tournamentId: string, reportId: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`result:confirm:${tournamentId}|${reportId}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`result:dispute:${tournamentId}|${reportId}`)
      .setLabel("Dispute")
      .setStyle(ButtonStyle.Danger)
  );

export const formatParticipantLine = (registration: any) =>
  `${registration.seed ? `#${registration.seed.seedNumber}` : "Unseeded"} • ${inlineCode(registration.participant.displayName)} • ${registration.status}`;
