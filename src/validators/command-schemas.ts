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

export const switchBracketNamesCommandSchema = z.object({
  tournamentId: idSchema,
  firstPlayerName: z.string().trim().min(2).max(80),
  secondPlayerName: z.string().trim().min(2).max(80)
});

export const tournamentIgnLookupCommandSchema = z.object({
  tournamentId: idSchema,
  name: z.string().trim().min(2).max(80)
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
