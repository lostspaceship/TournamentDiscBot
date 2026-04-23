import pkg from "@prisma/client";
import type { Prisma, GuildConfig, StaffRole } from "@prisma/client";

import { prisma } from "../config/prisma.js";

const { StaffRoleType } = pkg;

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

  public async updateConfig(
    guildId: string,
    data: Prisma.GuildConfigUpdateInput
  ): Promise<GuildConfig> {
    await this.getOrCreate(guildId);

    return prisma.guildConfig.update({
      where: { guildId },
      data
    });
  }

  public async listConfigsWithAlerts(): Promise<GuildConfig[]> {
    return prisma.guildConfig.findMany({
      where: {
        OR: [
          { twitchAlertEnabled: true },
          { youtubeAlertEnabled: true }
        ]
      },
      orderBy: { createdAt: "asc" }
    });
  }
}
