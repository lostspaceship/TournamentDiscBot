import { StaffRoleType } from "@prisma/client";
import type { ButtonInteraction, Interaction } from "discord.js";

import type { BootstrapContext, InteractionHandlerModule } from "../bootstrap/types.js";
import { env } from "../config/env.js";
import { parseSignedCustomId } from "./secure-payload.js";
import { AppError, PermissionError } from "../utils/errors.js";

const asGuildMember = (interaction: ButtonInteraction) => {
  if (!interaction.inCachedGuild()) {
    throw new PermissionError("This interaction must be used inside a server.");
  }
  return interaction.member;
};

export const tournamentStaffHandler: InteractionHandlerModule = {
  id: "tournament-staff-handler",
  canHandle(interaction: Interaction): boolean {
    if (!interaction.isButton()) {
      return false;
    }

    try {
      const parsed = parseSignedCustomId(interaction.customId, {
        maxAgeMs: env.INTERACTION_TTL_MS
      });
      return parsed.namespace === "staff" && parsed.action === "undo-advance";
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
      if (parsed.namespace !== "staff" || parsed.action !== "undo-advance") {
        return;
      }

      const member = asGuildMember(interaction);
      await context.permissionService.requireMinimumRole(
        interaction.guildId!,
        member,
        StaffRoleType.MODERATOR,
        "interaction.staff.undo-advance"
      );

      const [tournamentId, reportId, actorUserId] = parsed.entityId.split("|");
      if (!tournamentId || !reportId || !actorUserId) {
        throw new AppError("INVALID_INTERACTION", "This undo action is invalid.");
      }

      if (interaction.user.id !== actorUserId) {
        throw new PermissionError("This undo button belongs to another moderator.");
      }

      await context.matchReportingService.undoManualAdvance({
        guildId: interaction.guildId!,
        tournamentId,
        actorUserId: interaction.user.id,
        reportId
      });

      await interaction.update({
        content: "Manual advance undone and bracket restored.",
        components: []
      });
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.safeMessage
          : "An unexpected error occurred while undoing this manual advance.";

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
};
