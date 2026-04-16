import { BracketType, MatchStatus, type Prisma } from "@prisma/client";

import type { BracketSnapshot } from "../../domain/bracket/types.js";

export const persistBracketSnapshotTx = async (
  tx: Prisma.TransactionClient,
  tournamentId: string,
  snapshot: BracketSnapshot
): Promise<void> => {
  await tx.match.deleteMany({ where: { tournamentId } });
  await tx.bracket.deleteMany({ where: { tournamentId } });

  const persistedMatchIdBySnapshotId = new Map(
    Object.keys(snapshot.matches).map((matchId) => [matchId, `${tournamentId}:${matchId}`] as const)
  );

  const deferredLinks: Array<{
    id: string;
    nextMatchId: string | null;
    nextMatchSlot: number | null;
    loserNextMatchId: string | null;
    loserNextMatchSlot: number | null;
    resetOfMatchId: string | null;
  }> = [];

  for (const bracketType of [BracketType.WINNERS, BracketType.LOSERS, BracketType.GRAND_FINALS]) {
    const relevantRounds = snapshot.rounds.filter((round) => {
      if (bracketType === BracketType.WINNERS) return round.side === "WINNERS";
      if (bracketType === BracketType.LOSERS) return round.side === "LOSERS";
      return round.side === "GRAND_FINALS";
    });

    if (relevantRounds.length === 0) continue;

    const bracket = await tx.bracket.create({
      data: {
        tournamentId,
        type: bracketType
      }
    });

    for (const round of relevantRounds) {
      const createdRound = await tx.round.create({
        data: {
          bracketId: bracket.id,
          roundNumber: round.roundNumber,
          name: round.name
        }
      });

      for (const matchId of round.matchIds) {
        const match = snapshot.matches[matchId]!;
        const persistedMatchId = persistedMatchIdBySnapshotId.get(match.id)!;
        await tx.match.create({
          data: {
            id: persistedMatchId,
            roundId: createdRound.id,
            tournamentId,
            sequence: match.sequence,
            bracketType,
            bestOf: match.bestOf,
            player1RegistrationId: match.slots[0].entrantId,
            player2RegistrationId: match.slots[1].entrantId,
            status:
              match.status === "READY"
                ? MatchStatus.READY
                : match.status === "COMPLETED"
                  ? MatchStatus.COMPLETED
                  : match.status === "CANCELLED"
                    ? MatchStatus.CANCELLED
                    : MatchStatus.PENDING,
            winnerRegistrationId: match.winnerId,
            loserRegistrationId: match.loserId,
            completedAt: match.status === "COMPLETED" ? new Date() : null
          }
        });

        deferredLinks.push({
          id: persistedMatchId,
          nextMatchId: match.nextMatchId
            ? persistedMatchIdBySnapshotId.get(match.nextMatchId) ?? null
            : null,
          nextMatchSlot: match.nextMatchSlot,
          loserNextMatchId: match.loserNextMatchId
            ? persistedMatchIdBySnapshotId.get(match.loserNextMatchId) ?? null
            : null,
          loserNextMatchSlot: match.loserNextMatchSlot,
          resetOfMatchId: match.resetOfMatchId
            ? persistedMatchIdBySnapshotId.get(match.resetOfMatchId) ?? null
            : null
        });
      }
    }
  }

  for (const link of deferredLinks) {
    await tx.match.update({
      where: { id: link.id },
      data: {
        nextMatchId: link.nextMatchId,
        nextMatchSlot: link.nextMatchSlot,
        loserNextMatchId: link.loserNextMatchId,
        loserNextMatchSlot: link.loserNextMatchSlot,
        resetOfMatchId: link.resetOfMatchId
      }
    });
  }
};
