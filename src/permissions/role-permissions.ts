import pkg from "@prisma/client";
import type { GuildMember } from "discord.js";

import type { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { PermissionError } from "../utils/errors.js";

const { StaffRoleType } = pkg;

export const permissionRank: Record<StaffRoleType, number> = {
  OWNER: 4,
  ADMIN: 3,
  MODERATOR: 2,
  TOURNAMENT_STAFF: 1
};

export class PermissionService {
  public constructor(private readonly guildConfigRepository: GuildConfigRepository) {}

  public async requireRole(
    guildId: string,
    member: GuildMember,
    minimumRole: StaffRoleType
  ): Promise<void> {
    const roles = await this.guildConfigRepository.listStaffRoles(guildId);
    const memberRoleIds = new Set(member.roles.cache.keys());
    const highestRole = roles
      .filter((role) => memberRoleIds.has(role.roleId))
      .map((role) => role.type)
      .sort((left, right) => permissionRank[right] - permissionRank[left])[0];

    const isGuildOwner = member.guild.ownerId === member.id;
    const isAdministrator = member.permissions.has("Administrator");

    if (
      isGuildOwner ||
      isAdministrator ||
      (highestRole && permissionRank[highestRole] >= permissionRank[minimumRole])
    ) {
      return;
    }

    throw new PermissionError();
  }
}
