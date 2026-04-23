import pkg from "@prisma/client";
import type { Prisma, Match, ResultReport } from "@prisma/client";

import { prisma } from "../config/prisma.js";

const { MatchStatus, RegistrationStatus } = pkg;

export class MatchRepository {
  public async getMatch(matchId: string) {
    return prisma.match.findUnique({
      where: { id: matchId },
      include: {
        reports: { orderBy: { createdAt: "desc" } },
        games: { orderBy: { gameNumber: "asc" } },
        round: { include: { bracket: true } }
      }
    });
  }

  public async listParticipantActiveMatches(tournamentId: string, registrationId: string) {
    return prisma.match.findMany({
      where: {
        tournamentId,
        status: { in: [MatchStatus.READY, MatchStatus.AWAITING_CONFIRMATION, MatchStatus.DISPUTED] },
        OR: [{ player1RegistrationId: registrationId }, { player2RegistrationId: registrationId }]
      },
      include: { round: true },
      orderBy: [{ round: { roundNumber: "asc" } }, { sequence: "asc" }]
    });
  }

  public async createResultReport(data: Prisma.ResultReportCreateInput): Promise<ResultReport> {
    return prisma.resultReport.create({ data });
  }

  public async markReportStatus(reportId: string, status: MatchStatus, actorField: Prisma.ResultReportUpdateInput) {
    return prisma.resultReport.update({
      where: { id: reportId },
      data: {
        status,
        ...actorField
      }
    });
  }

  public async confirmMatchUpdate(args: {
    matchId: string;
    version: number;
    winnerRegistrationId: string;
    loserRegistrationId: string;
    status: MatchStatus;
  }): Promise<Match> {
    const updated = await prisma.match.updateMany({
      where: {
        id: args.matchId,
        version: args.version
      },
      data: {
        version: { increment: 1 },
        winnerRegistrationId: args.winnerRegistrationId,
        loserRegistrationId: args.loserRegistrationId,
        completedAt: new Date(),
        status: args.status,
        lockedAt: null
      }
    });

    if (updated.count !== 1) {
      throw new Error("Optimistic lock failed.");
    }

    return prisma.match.findUniqueOrThrow({
      where: { id: args.matchId }
    });
  }

  public async updateTournamentPlacements(tournamentId: string, placements: string[]) {
    return prisma.$transaction(
      placements.map((registrationId, index) =>
        prisma.registration.updateMany({
          where: {
            id: registrationId,
            tournamentId,
            status: { notIn: [RegistrationStatus.DISQUALIFIED, RegistrationStatus.DROPPED] }
          },
          data: {
            placement: index + 1,
            status: index === 0 ? RegistrationStatus.ACTIVE : RegistrationStatus.ELIMINATED
          }
        })
      )
    );
  }
}
