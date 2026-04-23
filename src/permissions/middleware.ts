import pkg from "@prisma/client";
import type { GuildMember } from "discord.js";

import { replyPermissionDenied } from "./deny.js";
import type { PermissionService } from "./service.js";
import type { GuardedInteraction } from "./types.js";

const { StaffRoleType } = pkg;

export const ensureGuildInteraction = (
  interaction: GuardedInteraction
): interaction is GuardedInteraction & { guildId: string; member: GuildMember } =>
  Boolean(interaction.guildId && interaction.inGuild() && interaction.member);

export const withModeratorGuard = async <T>(
  interaction: GuardedInteraction,
  permissionService: PermissionService,
  action: string,
  handler: () => Promise<T>
): Promise<T | undefined> => {
  if (!ensureGuildInteraction(interaction)) {
    await replyPermissionDenied(interaction, "This action can only be used inside a server.");
    return undefined;
  }

  try {
    await permissionService.requireMinimumRole(
      interaction.guildId,
      interaction.member,
      StaffRoleType.MODERATOR,
      action
    );
    return await handler();
  } catch (error) {
    await replyPermissionDenied(interaction);
    return undefined;
  }
};

export const withStaffGuard = async <T>(
  interaction: GuardedInteraction,
  permissionService: PermissionService,
  action: string,
  handler: () => Promise<T>
): Promise<T | undefined> => {
  if (!ensureGuildInteraction(interaction)) {
    await replyPermissionDenied(interaction, "This action can only be used inside a server.");
    return undefined;
  }

  try {
    await permissionService.requireMinimumRole(
      interaction.guildId,
      interaction.member,
      StaffRoleType.TOURNAMENT_STAFF,
      action
    );
    return await handler();
  } catch {
    await replyPermissionDenied(interaction);
    return undefined;
  }
};

export const withParticipantGuard = async <T>(
  interaction: GuardedInteraction,
  permissionService: PermissionService,
  tournamentId: string,
  action: string,
  handler: (participant: { registrationId: string; participantId: string; status: string }) => Promise<T>
): Promise<T | undefined> => {
  if (!ensureGuildInteraction(interaction)) {
    await replyPermissionDenied(interaction, "This action can only be used inside a server.");
    return undefined;
  }

  try {
    const participant = await permissionService.requireParticipantAccess({
      tournamentId,
      actorUserId: interaction.user.id,
      requiredActiveRegistration: true
    });

    return await handler(participant);
  } catch {
    await replyPermissionDenied(interaction, "You are not allowed to perform this participant action.");
    return undefined;
  }
};
