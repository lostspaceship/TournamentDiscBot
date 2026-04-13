import { TournamentFormat } from "@prisma/client";
import { z } from "zod";

export const createTournamentSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(500).optional(),
  format: z.nativeEnum(TournamentFormat),
  maxParticipants: z.number().int().min(2).max(1024),
  bestOfDefault: z.number().int().min(1).max(11).refine((value) => value % 2 === 1, {
    message: "bestOfDefault must be an odd number."
  }),
  requireCheckIn: z.boolean().default(false),
  allowWaitlist: z.boolean().default(true),
  allowWithdrawals: z.boolean().default(true)
});

export const reportResultSchema = z.object({
  matchId: z.string().trim().min(1).max(64),
  winnerRegistrationId: z.string().trim().min(1).max(64),
  loserRegistrationId: z.string().trim().min(1).max(64),
  player1Score: z.number().int().min(0).max(99),
  player2Score: z.number().int().min(0).max(99),
  reason: z.string().trim().max(250).optional(),
  idempotencyKey: z.string().trim().min(8).max(100)
});

export const configTournamentSchema = z.object({
  tournamentId: z.string().trim().min(1),
  mutualExclusionKey: z.string().trim().max(50).optional(),
  seedingMethod: z.enum(["RANDOM", "MANUAL", "RATING_BASED"]).optional(),
  requireOpponentConfirmation: z.boolean().optional(),
  hasLosersBracket: z.boolean().optional(),
  grandFinalResetEnabled: z.boolean().optional()
});
