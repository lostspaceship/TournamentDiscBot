import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import { MatchStatus, TournamentStatus } from "@prisma/client";

import { buildSignedCustomId } from "../interactions/secure-payload.js";
import type {
  BracketRoundView,
  MatchDetailView,
  OverviewView,
  ParticipantsPageView,
  TournamentRulesView,
  StaffPanelView
} from "../services/viewing-service.js";

const colors = {
  brand: 0x2b6ef2,
  success: 0x1f8b4c,
  warning: 0xc27c0e,
  danger: 0xc23b22,
  neutral: 0x5865f2
};

const statusColor = (status: TournamentStatus | MatchStatus): number => {
  switch (status) {
    case TournamentStatus.IN_PROGRESS:
    case MatchStatus.READY:
      return colors.success;
    case TournamentStatus.PAUSED:
    case MatchStatus.AWAITING_CONFIRMATION:
    case MatchStatus.DISPUTED:
      return colors.warning;
    case TournamentStatus.CANCELLED:
    case MatchStatus.CANCELLED:
      return colors.danger;
    default:
      return colors.brand;
  }
};

const prettyStatus = (value: string): string =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (match) => match.toUpperCase());

const isDiscordSnowflake = (value: string): boolean => /^\d{17,20}$/.test(value);

const formatParticipantLine = (
  index: number,
  entry: ParticipantsPageView["entries"][number],
  showSeed: boolean
): string => {
  const prefix = showSeed && entry.seed != null ? `#${entry.seed}` : `${index}.`;
  const badges = [
    showSeed ? prettyStatus(entry.status) : null,
    showSeed && entry.checkedIn ? "Checked In" : null,
    entry.placement != null ? `Place ${entry.placement}` : null
  ]
    .filter(Boolean)
    .join(" | ");

  if (!showSeed) {
    const identity = isDiscordSnowflake(entry.discordUserId)
      ? `<@${entry.discordUserId}>`
      : entry.displayName;
    const detail = entry.leagueIgn ? ` - ${entry.leagueIgn}` : "";
    const suffix = badges ? ` | ${badges}` : "";
    return `**${prefix}** ${identity}${detail}${suffix}`;
  }

  return `**${prefix}** ${entry.displayName}${badges ? `\n${badges}` : ""}`;
};

export const buildOverviewEmbed = (view: OverviewView): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(statusColor(view.status))
    .setTitle(view.name)
    .addFields(
      {
        name: "Status",
        value: prettyStatus(view.status),
        inline: true
      },
      {
        name: "Registration",
        value: `${view.activeCount} registered`,
        inline: true
      },
      {
        name: "Match Format",
        value: `Best of ${view.bestOf}`,
        inline: true
      }
    );

export const buildParticipantsEmbed = (
  view: ParticipantsPageView,
  title: string,
  showSeed = true
): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(colors.neutral)
    .setTitle(title)
    .setDescription(
      view.entries.length > 0
        ? view.entries
            .map((entry, index) =>
              formatParticipantLine((view.page - 1) * 10 + index + 1, entry, showSeed)
            )
            .join("\n\n")
        : "No entries to display."
    )
    .setFooter({
      text: `Page ${view.page}/${view.totalPages} | ${view.totalCount} total`
    });

export const buildParticipantsComponents = (
  tournamentId: string,
  page: number,
  totalPages: number,
  kind: "participants" | "waitlist" | "overview-participants"
) => {
  const actionPrefix =
    kind === "participants" ? "p" : kind === "waitlist" ? "w" : "o";
  const nonceBase = `${actionPrefix}${String(page).padStart(5, "0")}`;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildSignedCustomId(
            "view",
            `${actionPrefix}p`,
            `${tournamentId}|${Math.max(1, page - 1)}`,
            `${nonceBase}prev`
          )
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(
          buildSignedCustomId(
            "view",
            `${actionPrefix}n`,
            `${tournamentId}|${Math.min(totalPages, page + 1)}`,
            `${nonceBase}next`
          )
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages)
    )
  ];
};

export const buildBracketRoundEmbed = (view: BracketRoundView): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(statusColor(view.status))
    .setTitle(`${view.tournamentName} | ${view.roundLabel}`)
    .setDescription(
      [
        view.isPreview
          ? "_Preview bracket. The official bracket locks when staff starts the tournament._"
          : null,
        view.matches.length > 0
          ? view.matches
              .map((match) =>
                [
                  `**Match ${match.sequence}** \`${match.id}\``,
                  `${match.player1Name} vs ${match.player2Name}`,
                  `Status: ${prettyStatus(match.status)}`,
                  match.winnerName ? `Winner: ${match.winnerName}` : null,
                  match.latestScore ? `Score: ${match.latestScore}` : null,
                  match.latestOutcome ? `Outcome: ${prettyStatus(match.latestOutcome)}` : null
                ]
                  .filter(Boolean)
                  .join("\n")
              )
              .join("\n\n")
          : "No matches found for this round."
      ]
        .filter(Boolean)
        .join("\n\n")
    )
    .setFooter({
      text: `${prettyStatus(view.selectedSide)} | Round ${view.selectedRoundNumber}`
    });

export const buildBracketRoundComponents = (view: BracketRoundView) => [
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(
        buildSignedCustomId(
          "view",
          "br",
          view.tournamentId,
          `${view.selectedSide[0]}${view.selectedRoundNumber}`
        )
      )
      .setPlaceholder("Jump to another bracket round")
      .addOptions(
        view.availableRounds.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description,
          default: option.value === `${view.selectedSide}:${view.selectedRoundNumber}`
        }))
      )
  )
];

export const buildOverviewWithParticipantsComponents = (
  tournamentId: string,
  page: number,
  totalPages: number
) => buildOverviewInfoComponents(tournamentId, "players", page, totalPages);

export const buildRulesEmbed = (view: TournamentRulesView): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(colors.neutral)
    .setTitle("Rules")
    .addFields(
      view.sections.map((section) => ({
        name: section.title,
        value:
          section.items.length > 0
            ? section.items.map((item) => `- ${item}`).join("\n")
            : "Not set.",
        inline: false
      }))
    );

export const buildOverviewInfoComponents = (
  tournamentId: string,
  tab: "players" | "rules",
  page: number,
  totalPages: number
) => {
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildSignedCustomId("view", "ovr", `${tournamentId}|1`, "ovr001")
        )
        .setLabel("Rules")
        .setStyle(tab === "rules" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          buildSignedCustomId("view", "ovp", `${tournamentId}|1`, "ovp001")
        )
        .setLabel("Players")
        .setStyle(tab === "players" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  ];

  if (tab === "players") {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            buildSignedCustomId(
              "view",
              "op",
              `${tournamentId}|${Math.max(1, page - 1)}`,
              `ovp${String(page).padStart(4, "0")}p`
            )
          )
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 1),
        new ButtonBuilder()
          .setCustomId(
            buildSignedCustomId(
              "view",
              "on",
              `${tournamentId}|${Math.min(totalPages, page + 1)}`,
              `ovp${String(page).padStart(4, "0")}n`
            )
          )
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages)
      )
    );
  }

  return rows;
};

export const buildMatchDetailEmbed = (view: MatchDetailView): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(statusColor(view.status))
    .setTitle(`${view.tournamentName} | Match ${view.sequence}`)
    .setDescription(`${view.player1Name} vs ${view.player2Name}`)
    .addFields(
      {
        name: "Bracket",
        value: `${prettyStatus(view.bracketType)} Round ${view.roundNumber}`,
        inline: true
      },
      {
        name: "Status",
        value: prettyStatus(view.status),
        inline: true
      },
      {
        name: "Format",
        value: `Best of ${view.bestOf}`,
        inline: true
      },
      {
        name: "Latest Result",
        value: [
          view.winnerName ? `Winner: ${view.winnerName}` : "Winner: Pending",
          view.latestScore ? `Score: ${view.latestScore}` : null,
          view.latestOutcome ? `Outcome: ${prettyStatus(view.latestOutcome)}` : null
        ]
          .filter(Boolean)
          .join("\n"),
        inline: false
      },
      {
        name: "Recent Reports",
        value:
          view.reports.length > 0
            ? view.reports
                .map((report) =>
                  [
                    `\`${report.id}\` | ${prettyStatus(report.status)} | ${prettyStatus(report.outcomeType)}`,
                    `<t:${Math.floor(report.createdAt.getTime() / 1000)}:R> | Submitted by ${report.submittedByUserId}`,
                    report.reason ?? null
                  ]
                    .filter(Boolean)
                    .join("\n")
                )
                .join("\n\n")
            : "No reports have been submitted for this match."
      }
    )
    .setFooter({ text: view.matchId });

export const buildStaffPanelEmbed = (
  view: StaffPanelView,
  tab: "overview" | "reports" | "participants"
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(colors.warning)
    .setTitle(`${view.tournamentName} | Staff Panel`)
    .setFooter({ text: `Tab: ${prettyStatus(tab)}` });

  if (tab === "overview") {
    return embed.setDescription(
      [
        `Status: **${prettyStatus(view.status)}**`,
        `Active participants: **${view.activeParticipants}**`,
        `Waitlist: **${view.waitlistCount}**`,
        `Active matches: **${view.activeMatches}**`,
        `Completed matches: **${view.completedMatches}**`,
        `Pending reports: **${view.pendingReports}**`,
        `Disputed reports: **${view.disputedReports}**`
      ].join("\n")
    );
  }

  if (tab === "reports") {
    return embed.setDescription(
      view.pendingReportItems.length > 0
        ? view.pendingReportItems
            .map(
              (entry) =>
                `**${entry.matchId}**\nReport \`${entry.reportId}\` | ${prettyStatus(entry.status)}\n<t:${Math.floor(entry.submittedAt.getTime() / 1000)}:R> | ${entry.submittedByUserId}`
            )
            .join("\n\n")
        : "No pending or disputed reports."
    );
  }

  return embed.setDescription(
    view.participantStatusCounts
      .map((entry) => `**${prettyStatus(entry.status)}**: ${entry.count}`)
      .join("\n")
  );
};

export const buildStaffPanelComponents = (
  tournamentId: string,
  actorUserId: string,
  activeTab: "overview" | "reports" | "participants"
) => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildSignedCustomId("view", "so", `${tournamentId}|${actorUserId}`, "so")
      )
      .setLabel("Overview")
      .setStyle(activeTab === "overview" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildSignedCustomId("view", "sr", `${tournamentId}|${actorUserId}`, "sr")
      )
      .setLabel("Reports")
      .setStyle(activeTab === "reports" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildSignedCustomId("view", "sp", `${tournamentId}|${actorUserId}`, "sp")
      )
      .setLabel("Participants")
      .setStyle(activeTab === "participants" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  )
];
