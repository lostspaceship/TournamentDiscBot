import { StaffRoleType } from "@prisma/client";
import type { GuildMember } from "discord.js";

import type { PermissionService } from "./service.js";
import type { ParticipantAccessResult } from "./types.js";

export const requireAdmin = async (
  permissionService: PermissionService,
  guildId: string,
  member: GuildMember,
  action: string
) => permissionService.requireMinimumRole(guildId, member, StaffRoleType.ADMIN, action);

export const requireModerator = async (
  permissionService: PermissionService,
  guildId: string,
  member: GuildMember,
  action: string
) => permissionService.requireMinimumRole(guildId, member, StaffRoleType.MODERATOR, action);

export const requireTournamentStaff = async (
  permissionService: PermissionService,
  guildId: string,
  member: GuildMember,
  action: string
) => permissionService.requireMinimumRole(guildId, member, StaffRoleType.TOURNAMENT_STAFF, action);

export const requireParticipant = async (
  permissionService: PermissionService,
  tournamentId: string,
  actorUserId: string,
  activeOnly = true
): Promise<ParticipantAccessResult> =>
  permissionService.requireParticipantAccess({
    tournamentId,
    actorUserId,
    requiredActiveRegistration: activeOnly
  });
