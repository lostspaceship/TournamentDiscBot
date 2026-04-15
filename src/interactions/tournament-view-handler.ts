import { BracketType, StaffRoleType } from "@prisma/client";
import type { ButtonInteraction, Interaction, StringSelectMenuInteraction } from "discord.js";

import type { BootstrapContext, InteractionHandlerModule } from "../bootstrap/types.js";
import { env } from "../config/env.js";
import { parseSignedCustomId } from "./secure-payload.js";
import {
  buildBracketRoundComponents,
  buildBracketRoundEmbed,
  buildOverviewEmbed,
  buildOverviewWithParticipantsComponents,
  buildParticipantsComponents,
  buildParticipantsEmbed,
  buildStaffPanelComponents,
  buildStaffPanelEmbed
} from "../utils/tournament-view-ui.js";
import { AppError, PermissionError } from "../utils/errors.js";

const asGuildMember = (interaction: ButtonInteraction | StringSelectMenuInteraction) => {
  if (!interaction.inCachedGuild()) {
    throw new PermissionError("This interaction must be used inside a server.");
  }
  return interaction.member;
};

const parseBracketSelection = (
  value: string
): { side: BracketType; roundNumber: number } => {
  const [side, roundValue] = value.split(":");

  if (
    side !== BracketType.WINNERS &&
    side !== BracketType.LOSERS &&
    side !== BracketType.GRAND_FINALS
  ) {
    throw new AppError("INVALID_INTERACTION", "This bracket selection is invalid.");
  }

  const roundNumber = Number(roundValue);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new AppError("INVALID_INTERACTION", "This bracket round is invalid.");
  }

  return { side, roundNumber };
};

export const tournamentViewHandler: InteractionHandlerModule = {
  id: "tournament-view-handler",
  canHandle(interaction: Interaction): boolean {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
      return false;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId, {
        maxAgeMs: env.INTERACTION_TTL_MS
      });
      return parsed.namespace === "view";
    } catch {
      return false;
    }
  },
  async handle(interaction: Interaction, context: BootstrapContext): Promise<void> {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
      return;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId, {
        maxAgeMs: env.INTERACTION_TTL_MS
      });
      if (parsed.namespace !== "view") {
        return;
      }

      if (parsed.action === "pp" || parsed.action === "pn") {
        const [tournamentId, pageValue] = parsed.entityId.split("|");
        const page = Number(pageValue);
        const view = await context.viewingService.getParticipantsPage(interaction.guildId!, tournamentId!, page);

        await interaction.update({
          embeds: [buildParticipantsEmbed(view, "Participants")],
          components: buildParticipantsComponents(view.tournamentId, view.page, view.totalPages, "participants")
        });
        return;
      }

      if (parsed.action === "op" || parsed.action === "on") {
        const [tournamentId, pageValue] = parsed.entityId.split("|");
        const page = Number(pageValue);
        const overview = await context.viewingService.getOverview(interaction.guildId!, tournamentId!);
        const view = await context.viewingService.getParticipantsPage(interaction.guildId!, tournamentId!, page);

        await interaction.update({
          embeds: [buildOverviewEmbed(overview), buildParticipantsEmbed(view, "Registered Players")],
          components: buildOverviewWithParticipantsComponents(view.tournamentId, view.page, view.totalPages)
        });
        return;
      }

      if (parsed.action === "wp" || parsed.action === "wn") {
        const [tournamentId, pageValue] = parsed.entityId.split("|");
        const page = Number(pageValue);
        const view = await context.viewingService.getWaitlistPage(interaction.guildId!, tournamentId!, page);

        await interaction.update({
          embeds: [buildParticipantsEmbed(view, "Waitlist", false)],
          components: buildParticipantsComponents(view.tournamentId, view.page, view.totalPages, "waitlist")
        });
        return;
      }

      if (parsed.action === "br") {
        if (!interaction.isStringSelectMenu()) {
          throw new AppError("INVALID_INTERACTION", "This control expects a round selection.");
        }

        const selection = interaction.values[0];
        if (!selection) {
          throw new AppError("INVALID_INTERACTION", "No bracket round was selected.");
        }

        const { side, roundNumber } = parseBracketSelection(selection);
        const view = await context.viewingService.getBracketRound(
          interaction.guildId!,
          parsed.entityId,
          side,
          roundNumber
        );

        await interaction.update({
          embeds: [buildBracketRoundEmbed(view)],
          components: buildBracketRoundComponents(view)
        });
        return;
      }

      if (parsed.action === "so" || parsed.action === "sr" || parsed.action === "sp") {
        const member = asGuildMember(interaction);
        await context.permissionService.requireMinimumRole(
          interaction.guildId!,
          member,
          StaffRoleType.TOURNAMENT_STAFF,
          `interaction.view.${parsed.action}`
        );

        const [tournamentId, actorUserId] = parsed.entityId.split("|");
        if (actorUserId !== interaction.user.id) {
          throw new PermissionError("This staff panel belongs to another moderator.");
        }

        const tab =
          parsed.action === "so"
            ? "overview"
            : parsed.action === "sr"
              ? "reports"
              : "participants";
        const view = await context.viewingService.getStaffPanel(
          interaction.guildId!,
          tournamentId!,
          StaffRoleType.TOURNAMENT_STAFF
        );

        await interaction.update({
          embeds: [buildStaffPanelEmbed(view, tab)],
          components: buildStaffPanelComponents(tournamentId!, interaction.user.id, tab)
        });
      }
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.safeMessage
          : "An unexpected error occurred while updating this view.";

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
};
