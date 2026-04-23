import pkg from "@prisma/client";
import { z } from "zod";

const { SeedingMethod, TournamentFormat } = pkg;

const idSchema = z.string().trim().min(1).max(64);

export const tournamentIdSchema = z.object({
  tournamentId: idSchema
});

export const createTournamentCommandSchema = z.object({
  name: z.string().trim().min(3).max(80).default("V2 1v1 Viewer Tournament"),
  announcementChannelId: z.string().trim().min(1).max(32),
  format: z.nativeEnum(TournamentFormat).default(TournamentFormat.SINGLE_ELIMINATION),
  maxParticipants: z.number().int().min(2).max(4096).default(256),
  bestOfDefault: z.number()
    .int()
    .min(1)
    .max(11)
    .refine((value) => value % 2 === 1, {
      message: "Best-of value must be odd."
    })
    .default(3)
});

export const joinTournamentCommandSchema = z.object({
  tournamentId: idSchema,
  name: z.string().trim().min(2).max(80),
  leagueIgn: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[^#\r\n]{1,50}#[^#\r\n]{1,50}$/, "League ID must look like name#tag.")
});

export const addTournamentParticipantCommandSchema = z.object({
  tournamentId: idSchema,
  targetUserId: idSchema,
  name: z.string().trim().min(2).max(80),
  leagueIgn: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[^#\r\n]{1,50}#[^#\r\n]{1,50}$/, "League ID must look like name#tag.")
});

export const configTournamentCommandSchema = z.object({
  tournamentId: idSchema,
  seedingMethod: z.nativeEnum(SeedingMethod).optional(),
  mutualExclusionKey: z.string().trim().min(1).max(50).optional().nullable(),
  requireOpponentConfirmation: z.boolean().optional(),
  grandFinalResetEnabled: z.boolean().optional(),
  allowWithdrawals: z.boolean().optional()
});

export const reseedCommandSchema = z.object({
  tournamentId: idSchema,
  method: z.nativeEnum(SeedingMethod)
});

export const manualAdvanceCommandSchema = z.object({
  tournamentId: idSchema,
  targetPlayerName: z.string().trim().min(2).max(80)
});

export const kickParticipantCommandSchema = z.object({
  tournamentId: idSchema,
  targetPlayerName: z.string().trim().min(2).max(80)
});

export const setPlayerBackCommandSchema = z.object({
  tournamentId: idSchema,
  targetPlayerName: z.string().trim().min(2).max(80)
});

export const switchBracketNamesCommandSchema = z.object({
  tournamentId: idSchema,
  firstPlayerName: z.string().trim().min(2).max(80),
  secondPlayerName: z.string().trim().min(2).max(80)
});

export const renameParticipantCommandSchema = z.object({
  tournamentId: idSchema,
  currentPlayerName: z.string().trim().min(2).max(80),
  nextPlayerName: z.string().trim().min(2).max(80)
});

export const tournamentIgnLookupCommandSchema = z.object({
  tournamentId: idSchema,
  name: z.string().trim().min(2).max(80)
});

export const serverRulesCreateCommandSchema = z.object({
  title: z.string().trim().min(1).max(80).default("Server Rules"),
  text: z.string().trim().min(1).max(4000),
  heroImageUrl: z.string().url().max(500).optional().nullable()
});

export const serverSocialsCreateCommandSchema = z.object({
  title: z.string().trim().min(1).max(80).default("Social Links"),
  links: z.string().trim().min(1).max(4000),
  heroImageUrl: z.string().url().max(500).optional().nullable()
});

export const alertsTwitchCommandSchema = z.object({
  channelId: z.string().trim().min(1).max(32),
  username: z.string().trim().min(1).max(50),
  roleId: z.string().trim().min(1).max(32).optional().nullable()
});

export const alertsYouTubeCommandSchema = z.object({
  channelId: z.string().trim().min(1).max(32),
  youtubeChannelId: z.string().trim().min(1).max(128),
  roleId: z.string().trim().min(1).max(32).optional().nullable()
});

export const alertsRoleMessageCommandSchema = z.object({
  channelId: z.string().trim().min(1).max(32),
  twitchRoleId: z.string().trim().min(1).max(32).optional().nullable(),
  youtubeRoleId: z.string().trim().min(1).max(32).optional().nullable(),
  title: z.string().trim().min(1).max(80).default("Notification Roles"),
  description: z.string().trim().min(1).max(1000).default("Choose which notifications you want to receive.")
}).superRefine((value, ctx) => {
  if (!value.twitchRoleId && !value.youtubeRoleId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Set at least one notification role.",
      path: ["twitchRoleId"]
    });
  }
});

export const alertsDisableCommandSchema = z.object({
  platform: z.enum(["TWITCH", "YOUTUBE", "BOTH"])
});

const tournamentRulesCommandBaseSchema = z.object({
  tournamentId: idSchema,
  section: z.enum(["MODE", "WIN_CONDITIONS", "BANS", "SUMMONERS", "EXTRA_INFO"]),
  mode: z.enum(["ADD", "REPLACE", "CLEAR"]),
  value: z.string().trim().min(1).max(180).optional()
});

export const tournamentRulesCommandSchema = tournamentRulesCommandBaseSchema.superRefine((value, ctx) => {
  if (value.mode !== "CLEAR" && !value.value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A rule value is required unless you are clearing the section.",
      path: ["value"]
    });
  }
});
