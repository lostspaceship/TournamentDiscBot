import type { Interaction } from "discord.js";

import type { BootstrapContext, InteractionHandlerModule } from "../bootstrap/types.js";
import { parseSignedCustomId } from "./secure-payload.js";
import {
  buildOverviewEmbed,
  buildOverviewInfoComponents,
  buildParticipantsEmbed,
  buildRulesEmbed,
  buildParticipantsComponents
} from "../utils/tournament-view-ui.js";
import { AppError } from "../utils/errors.js";

export const tournamentViewHandler: InteractionHandlerModule = {
  id: "tournament-view-handler",
  canHandle(interaction: Interaction): boolean {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
      return false;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId);
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
      const parsed = parseSignedCustomId(interaction.customId);
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
        await context.tournamentRepository.updateInfoViewState(tournamentId!, {
          tab: "PLAYERS",
          page: view.page
        });

        await interaction.update({
          embeds: [buildOverviewEmbed(overview), buildParticipantsEmbed(view, "Registered Players", false)],
          components: buildOverviewInfoComponents(view.tournamentId, "players", view.page, view.totalPages)
        });
        return;
      }

      if (parsed.action === "ovp") {
        const [tournamentId] = parsed.entityId.split("|");
        const overview = await context.viewingService.getOverview(interaction.guildId!, tournamentId!);
        const view = await context.viewingService.getParticipantsPage(interaction.guildId!, tournamentId!, 1);
        await context.tournamentRepository.updateInfoViewState(tournamentId!, {
          tab: "PLAYERS",
          page: view.page
        });

        await interaction.update({
          embeds: [buildOverviewEmbed(overview), buildParticipantsEmbed(view, "Registered Players", false)],
          components: buildOverviewInfoComponents(view.tournamentId, "players", view.page, view.totalPages)
        });
        return;
      }

      if (parsed.action === "ovr") {
        const [tournamentId] = parsed.entityId.split("|");
        const overview = await context.viewingService.getOverview(interaction.guildId!, tournamentId!);
        const rules = await context.viewingService.getRulesView(interaction.guildId!, tournamentId!);
        await context.tournamentRepository.updateInfoViewState(tournamentId!, {
          tab: "RULES",
          page: 1
        });

        await interaction.update({
          embeds: [buildOverviewEmbed(overview), buildRulesEmbed(rules)],
          components: buildOverviewInfoComponents(tournamentId!, "rules", 1, 1)
        });
        return;
      }

    } catch (error) {
      const message =
        error instanceof AppError
          ? error.safeMessage
          : "Refresh the post and try again.";

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
};
