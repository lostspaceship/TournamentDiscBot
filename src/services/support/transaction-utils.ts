import pkg from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { ConflictError } from "../../utils/errors.js";

const { AuditAction } = pkg;

export type TransactionClient = Prisma.TransactionClient;

export const lockTournamentTx = async (
  tx: TransactionClient,
  tournamentId: string
): Promise<void> => {
  await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
};

export const lockMatchTx = async (
  tx: TransactionClient,
  matchId: string
): Promise<void> => {
  await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;
};

export const writeAuditLogTx = async (
  tx: TransactionClient,
  args: {
    tournamentId: string;
    guildId: string;
    actorUserId: string;
    action: AuditAction;
    targetType: string;
    targetId: string;
    reason?: string;
    metadataJson?: Prisma.JsonObject;
  }
): Promise<void> => {
  await tx.auditLog.create({ data: args });
};

export const mapUniqueConstraintError = (
  error: unknown,
  message: string
): Error => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictError(message);
  }

  return error as Error;
};
