import { StaffRoleType, type GuildConfig, type StaffRole } from "@prisma/client";

import { prisma } from "../config/prisma.js";

export class GuildConfigRepository {
  public async getOrCreate(guildId: string): Promise<GuildConfig> {
    return prisma.guildConfig.upsert({
      where: { guildId },
      update: {},
      create: { guildId }
    });
  }

  public async listStaffRoles(guildId: string): Promise<StaffRole[]> {
    return prisma.staffRole.findMany({
      where: { guildId },
      orderBy: { createdAt: "asc" }
    });
  }

  public async upsertStaffRole(args: {
    guildId: string;
    guildConfigId: string;
    roleId: string;
    type: StaffRoleType;
  }): Promise<StaffRole> {
    return prisma.staffRole.upsert({
      where: {
        guildId_roleId_type: {
          guildId: args.guildId,
          roleId: args.roleId,
          type: args.type
        }
      },
      update: {},
      create: args
    });
  }
}
