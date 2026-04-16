import { BracketType, MatchOutcomeType, SeedingMethod, TournamentFormat } from "@prisma/client";
import { z } from "zod";

const idSchema = z.string().trim().min(1).max(64);
const optionalReasonSchema = z.string().trim().max(250).optional().nullable();
const requiredReasonSchema = z.string().trim().min(1).max(250);
const matchReportBaseSchema = z.object({
  tournamentId: idSchema,
  matchId: idSchema,
  winnerRegistrationId: idSchema,
  loserRegistrationId: idSchema,
  outcomeType: z.nativeEnum(MatchOutcomeType),
  winnerScore: z.number().int().min(0).max(99).optional().nullable(),
  loserScore: z.number().int().min(0).max(99).optional().nullable(),
  reason: optionalReasonSchema
});

export const tournamentIdSchema = z.object({
  tournamentId: idSchema
});

export const reasonedTournamentActionSchema = z.object({
  tournamentId: idSchema,
  reason: requiredReasonSchema
});

export const createTournamentCommandSchema = z.object({
  name: z.string().trim().min(3).max(80).default("V2 1v1 Viewer Tournament"),
  announcementChannelId: z.string().trim().min(1).max(32),
  format: z.nativeEnum(TournamentFormat).default(TournamentFormat.SINGLE_ELIMINATION),
  maxParticipants: z.number().int().min(2).max(4096).default(256),
  bestOfDefault: z.number().int().min(1).max(11).refine((value) => value % 2 === 1, {
    message: "Best-of value must be odd."
  }).default(3)
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

export const matchReportCommandSchema = matchReportBaseSchema.superRefine((value, ctx) => {
    if (value.outcomeType === MatchOutcomeType.SCORE) {
      if (value.winnerScore == null || value.loserScore == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Score-based reports require both scores.",
          path: ["winnerScore"]
        });
      }
      return;
    }

    if (value.winnerScore != null || value.loserScore != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Scores are only valid for score-based outcomes.",
        path: ["winnerScore"]
      });
    }
});

export const confirmResultCommandSchema = z.object({
  tournamentId: idSchema,
  reportId: idSchema
});

export const disputeResultCommandSchema = z.object({
  tournamentId: idSchema,
  reportId: idSchema,
  reason: requiredReasonSchema
});

export const bracketRoundCommandSchema = z.object({
  tournamentId: idSchema,
  side: z.nativeEnum(BracketType),
  roundNumber: z.number().int().min(1).max(64)
});

export const matchViewCommandSchema = z.object({
  tournamentId: idSchema,
  matchId: idSchema.optional()
});

export const staffOverrideCommandSchema = matchReportBaseSchema.extend({
  reason: requiredReasonSchema
}).superRefine((value, ctx) => {
  if (value.outcomeType === MatchOutcomeType.SCORE) {
    if (value.winnerScore == null || value.loserScore == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Score-based reports require both scores.",
        path: ["winnerScore"]
      });
    }
    return;
  }

  if (value.winnerScore != null || value.loserScore != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Scores are only valid for score-based outcomes.",
      path: ["winnerScore"]
    });
  }
});

export const moderationCommandSchema = z.object({
  tournamentId: idSchema,
  targetUserId: z.string().trim().min(1).max(64),
  reason: requiredReasonSchema
});

export const reseedCommandSchema = z.object({
  tournamentId: idSchema,
  method: z.nativeEnum(SeedingMethod),
  reason: requiredReasonSchema
});

export const manualAdvanceCommandSchema = z
  .object({
    tournamentId: idSchema,
    targetUserId: z.string().trim().min(1).max(64).optional(),
    targetPlayerName: z.string().trim().min(2).max(80).optional()
  })
  .refine((value) => Boolean(value.targetUserId) !== Boolean(value.targetPlayerName), {
    message: "Provide either a Discord user or a player name.",
    path: ["targetUserId"]
  });

export const fakePlayersCommandSchema = z.object({
  tournamentId: idSchema,
  count: z.number().int().min(1).max(64),
  prefix: z.string().trim().min(1).max(40).optional()
});
