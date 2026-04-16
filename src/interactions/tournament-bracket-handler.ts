import type { ButtonInteraction, Interaction } from "discord.js";

import type { BootstrapContext, InteractionHandlerModule } from "../bootstrap/types.js";
import { env } from "../config/env.js";
import type { BracketTabKey } from "../renderers/bracket-paging.js";
import { parseSignedCustomId } from "./secure-payload.js";
import { AppError } from "../utils/errors.js";

export const tournamentBracketHandler: InteractionHandlerModule = {
  id: "tournament-bracket-handler",
  canHandle(interaction: Interaction): boolean {
    if (!interaction.isButton()) {
      return false;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId, {
        maxAgeMs: env.INTERACTION_TTL_MS
      });
      return parsed.namespace === "bracket" && (parsed.action === "bp" || parsed.action === "bn" || parsed.action === "bt");
    } catch {
      return false;
    }
  },
  async handle(interaction: Interaction, context: BootstrapContext): Promise<void> {
    if (!interaction.isButton()) {
      return;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId, {
        maxAgeMs: env.INTERACTION_TTL_MS
      });
      if (parsed.namespace !== "bracket") {
        return;
      }

      const [tournamentId, tabValue, pageValue] = parsed.entityId.split("|");
      const page = Number(pageValue);
      if (!tournamentId || !isTabKey(tabValue) || !Number.isInteger(page) || page < 1) {
        throw new AppError("INVALID_INTERACTION", "This bracket page is invalid.");
      }

      const payload = await context.bracketSyncService.buildBracketMessagePayload(tournamentId, tabValue, page, {
        persistState: true
      });
      await interaction.update({
        ...payload,
        attachments: []
      });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.safeMessage
          : "An unexpected error occurred while updating this bracket view.";

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
};

const isTabKey = (value: string | undefined): value is BracketTabKey =>
  value === "WINNERS" || value === "LOSERS" || value === "FINALS" || value === "PLACEMENTS";
