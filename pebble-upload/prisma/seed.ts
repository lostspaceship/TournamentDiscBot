import { StaffRoleType, TournamentFormat } from "@prisma/client";

import { prisma } from "../src/config/prisma.js";

const run = async () => {
  const guildConfig = await prisma.guildConfig.upsert({
    where: { guildId: "example-guild" },
    update: {},
    create: {
      guildId: "example-guild",
      defaultCheckInRequired: true,
      defaultMutualExclusion: false
    }
  });

  await prisma.staffRole.upsert({
    where: {
      guildId_roleId_type: {
        guildId: "example-guild",
        roleId: "tournament-staff-role",
        type: StaffRoleType.TOURNAMENT_STAFF
      }
    },
    update: {},
    create: {
      guildConfigId: guildConfig.id,
      guildId: "example-guild",
      roleId: "tournament-staff-role",
      type: StaffRoleType.TOURNAMENT_STAFF
    }
  });

  const tournament = await prisma.tournament.create({
    data: {
      guildConfigId: guildConfig.id,
      guildId: "example-guild",
      createdByUserId: "example-admin",
      name: "Example Weekly Cup",
      slug: "example-weekly-cup",
      gameTitle: "League of Legends (OP.GG)",
      description: null,
      format: TournamentFormat.SINGLE_ELIMINATION,
      maxParticipants: 16,
      requireCheckIn: false,
      allowWaitlist: false,
      settings: {
        create: {
          hasLosersBracket: false,
          requireOpponentConfirmation: true
        }
      }
    }
  });

  console.log(`Seed complete: ${tournament.id}`);
};

run()
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
