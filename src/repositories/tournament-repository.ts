import {
  AuditAction,
  BracketType,
  MatchStatus,
  Prisma,
  RegistrationStatus,
  TournamentStatus,
  type Tournament as PrismaTournament,
  type Participant,
  type Registration,
  type Tournament
} from "@prisma/client";

import { prisma } from "../config/prisma.js";
import { slugify } from "../utils/slug.js";

export class TournamentRepository {
  public static readonly ACTIVE_STATUSES: TournamentStatus[] = [
    TournamentStatus.REGISTRATION_OPEN,
    TournamentStatus.REGISTRATION_CLOSED,
    TournamentStatus.CHECK_IN,
    TournamentStatus.IN_PROGRESS,
    TournamentStatus.PAUSED
  ];

  public async createTournament(data: Prisma.TournamentCreateInput): Promise<Tournament> {
    return prisma.tournament.create({
      data,
      include: { settings: true }
    });
  }

  public async getTournament(tournamentId: string) {
    return prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        settings: true,
        registrations: {
          include: { participant: true, seed: true, checkIn: true },
          orderBy: [{ seed: { seedNumber: "asc" } }, { joinedAt: "asc" }]
        },
        brackets: {
          include: {
            rounds: {
              include: {
                matches: {
                  include: { reports: true, games: true },
                  orderBy: { sequence: "asc" }
                }
              },
              orderBy: { roundNumber: "asc" }
            }
          }
        },
        waitlistEntries: {
          include: { participant: true },
          orderBy: { position: "asc" }
        },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 50
        }
      }
    });
  }

  public async resolveTournamentReference(guildId: string, reference: string): Promise<string | null> {
    const trimmed = reference.trim();
    const byId = await prisma.tournament.findFirst({
      where: {
        guildId,
        id: trimmed
      },
      select: { id: true }
    });

    if (byId) {
      return byId.id;
    }

    const activeByName = await prisma.tournament.findFirst({
      where: {
        guildId,
        name: {
          equals: trimmed,
          mode: "insensitive"
        },
        status: {
          in: TournamentRepository.ACTIVE_STATUSES
        }
      },
      select: { id: true },
      orderBy: { createdAt: "desc" }
    });

    if (activeByName) {
      return activeByName.id;
    }

    const activeBySlug = await prisma.tournament.findFirst({
      where: {
        guildId,
        slug: slugify(trimmed),
        status: {
          in: TournamentRepository.ACTIVE_STATUSES
        }
      },
      select: { id: true },
      orderBy: { createdAt: "desc" }
    });

    if (activeBySlug) {
      return activeBySlug.id;
    }

    const byName = await prisma.tournament.findFirst({
      where: {
        guildId,
        name: {
          equals: trimmed,
          mode: "insensitive"
        }
      },
      select: { id: true },
      orderBy: { createdAt: "desc" }
    });

    if (byName) {
      return byName.id;
    }

    const bySlug = await prisma.tournament.findFirst({
      where: {
        guildId,
        slug: slugify(trimmed)
      },
      select: { id: true },
      orderBy: { createdAt: "desc" }
    });

    return bySlug?.id ?? null;
  }

  public async getLatestActiveTournamentId(guildId: string): Promise<string | null> {
    const tournament = await prisma.tournament.findFirst({
      where: {
        guildId,
        status: {
          in: TournamentRepository.ACTIVE_STATUSES
        }
      },
      select: { id: true },
      orderBy: { createdAt: "desc" }
    });

    return tournament?.id ?? null;
  }

  public async listTournaments(guildId: string, status?: TournamentStatus) {
    return prisma.tournament.findMany({
      where: { guildId, status },
      include: { settings: true },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  public async updateTournament(
    tournamentId: string,
    data: Prisma.TournamentUpdateInput
  ): Promise<Tournament> {
    return prisma.tournament.update({
      where: { id: tournamentId },
      data
    });
  }

  public async updateBracketViewState(
    tournamentId: string,
    state: {
      tab: string;
      page: number;
    }
  ): Promise<PrismaTournament> {
    return prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        bracketViewTab: state.tab,
        bracketViewPage: state.page
      }
    });
  }

  public async createOrGetParticipant(args: {
    guildId: string;
    discordUserId: string;
    displayName: string;
  }): Promise<Participant> {
    return prisma.participant.upsert({
      where: {
        guildId_discordUserId: {
          guildId: args.guildId,
          discordUserId: args.discordUserId
        }
      },
      update: {
        displayName: args.displayName
      },
      create: args
    });
  }

  public async findActiveMutualExclusion(args: {
    guildId: string;
    participantId: string;
    mutualExclusionKey: string;
    tournamentId: string;
  }): Promise<Registration | null> {
    return prisma.registration.findFirst({
      where: {
        participantId: args.participantId,
        tournamentId: { not: args.tournamentId },
        status: RegistrationStatus.ACTIVE,
        tournament: {
          guildId: args.guildId,
          mutualExclusionKey: args.mutualExclusionKey,
          status: { in: [TournamentStatus.REGISTRATION_OPEN, TournamentStatus.REGISTRATION_CLOSED, TournamentStatus.CHECK_IN, TournamentStatus.IN_PROGRESS, TournamentStatus.PAUSED] }
        }
      }
    });
  }

  public async joinTournament(args: {
    tournamentId: string;
    participantId: string;
    registrationKey: string;
    waitlist: boolean;
  }) {
    return prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: args.tournamentId },
        include: {
          registrations: {
            where: { status: RegistrationStatus.ACTIVE }
          },
          waitlistEntries: true
        }
      });

      if (args.waitlist) {
        return tx.waitlistEntry.create({
          data: {
            tournamentId: args.tournamentId,
            participantId: args.participantId,
            position: tournament.waitlistEntries.length + 1
          }
        });
      }

      return tx.registration.create({
        data: {
          tournamentId: args.tournamentId,
          participantId: args.participantId,
          registrationKey: args.registrationKey
        }
      });
    });
  }

  public async withdrawRegistration(registrationId: string) {
    return prisma.registration.update({
      where: { id: registrationId },
      data: {
        status: RegistrationStatus.WITHDRAWN,
        withdrawnAt: new Date()
      }
    });
  }

  public async writeAuditLog(args: {
    tournamentId: string;
    guildId: string;
    actorUserId: string;
    action: AuditAction;
    targetType: string;
    targetId: string;
    reason?: string;
    metadataJson?: Prisma.JsonObject;
  }) {
    return prisma.auditLog.create({ data: args });
  }

  public async createBracketSnapshot(args: {
    tournamentId: string;
    bestOf: number;
    rounds: Array<{
      bracketType: BracketType;
      roundNumber: number;
      name: string;
      matches: Array<{
        id: string;
        sequence: number;
        bestOf: number;
        player1RegistrationId: string | null;
        player2RegistrationId: string | null;
        status: MatchStatus;
        winnerRegistrationId: string | null;
        loserRegistrationId: string | null;
        nextMatchId: string | null;
        nextMatchSlot: number | null;
        loserNextMatchId: string | null;
        loserNextMatchSlot: number | null;
        resetOfMatchId: string | null;
      }>;
    }>;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.bracket.deleteMany({ where: { tournamentId: args.tournamentId } });
      const deferredLinks: Array<{
        id: string;
        nextMatchId: string | null;
        nextMatchSlot: number | null;
        loserNextMatchId: string | null;
        loserNextMatchSlot: number | null;
        resetOfMatchId: string | null;
      }> = [];

      for (const bracketType of [BracketType.WINNERS, BracketType.LOSERS, BracketType.GRAND_FINALS]) {
        const relevantRounds = args.rounds.filter((round) => round.bracketType === bracketType);
        if (relevantRounds.length === 0) {
          continue;
        }

        const bracket = await tx.bracket.create({
          data: {
            tournamentId: args.tournamentId,
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

          for (const match of round.matches) {
            await tx.match.create({
              data: {
                id: match.id,
                roundId: createdRound.id,
                tournamentId: args.tournamentId,
                sequence: match.sequence,
                bracketType,
                bestOf: match.bestOf,
                player1RegistrationId: match.player1RegistrationId,
                player2RegistrationId: match.player2RegistrationId,
                status: match.status,
                winnerRegistrationId: match.winnerRegistrationId,
                loserRegistrationId: match.loserRegistrationId,
                completedAt: match.status === MatchStatus.COMPLETED ? new Date() : null
              }
            });

            deferredLinks.push({
              id: match.id,
              nextMatchId: match.nextMatchId,
              nextMatchSlot: match.nextMatchSlot,
              loserNextMatchId: match.loserNextMatchId,
              loserNextMatchSlot: match.loserNextMatchSlot,
              resetOfMatchId: match.resetOfMatchId
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
    });
  }

  public async assignSeeds(tournamentId: string, registrationIds: string[]) {
    return prisma.$transaction(async (tx) => {
      await tx.seed.deleteMany({ where: { tournamentId } });
      for (let index = 0; index < registrationIds.length; index += 1) {
        await tx.seed.create({
          data: {
            tournamentId,
            registrationId: registrationIds[index]!,
            seedNumber: index + 1
          }
        });
      }
    });
  }
}
