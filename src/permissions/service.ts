import pkg from "@prisma/client";
import type { GuildMember } from "discord.js";

import { GuildConfigRepository } from "../repositories/guild-config-repository.js";
import { TournamentRepository } from "../repositories/tournament-repository.js";
import { PermissionError } from "../utils/errors.js";
import { permissionRank } from "./policies.js";
import type {
  GuildPermissionContext,
  ParticipantAccessResult,
  ParticipantScope,
  PermissionAuditHook
} from "./types.js";

const { RegistrationStatus, StaffRoleType } = pkg;

export class PermissionService {
  public constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly tournamentRepository: TournamentRepository,
    private readonly auditHook?: PermissionAuditHook
  ) {}

  public async resolveGuildContext(guildId: string, member: GuildMember): Promise<GuildPermissionContext> {
    await this.guildConfigRepository.getOrCreate(guildId);
    const mappedRoles = await this.guildConfigRepository.listStaffRoles(guildId);
    const memberRoleIds = new Set(member.roles.cache.keys());
    const mappedRoleTypes = mappedRoles
      .filter((role) => memberRoleIds.has(role.roleId))
      .map((role) => role.type);

    return {
      guildId,
      guildOwnerId: member.guild.ownerId,
      member,
      mappedRoleTypes,
      isGuildOwner: member.guild.ownerId === member.id,
      isDiscordAdministrator: member.permissions.has("Administrator")
    };
  }

  public async requireMinimumRole(
    guildId: string,
    member: GuildMember,
    minimumRole: StaffRoleType,
    auditAction: string
  ): Promise<GuildPermissionContext> {
    const context = await this.resolveGuildContext(guildId, member);

    const allowed =
      context.isGuildOwner ||
      context.isDiscordAdministrator ||
      context.mappedRoleTypes.some((role) => permissionRank[role] >= permissionRank[minimumRole]);

    await this.auditHook?.onDecision({
      guildId,
      actorUserId: member.id,
      outcome: allowed ? "ALLOWED" : "DENIED",
      action: auditAction,
      metadata: {
        minimumRole
      },
      reason: allowed ? undefined : "Minimum staff role not satisfied"
    });

    if (!allowed) {
      throw new PermissionError();
    }

    return context;
  }

  public async requireParticipantAccess(scope: ParticipantScope): Promise<ParticipantAccessResult> {
    const tournament = await this.tournamentRepository.getTournament(scope.tournamentId);
    const registration = tournament?.registrations.find(
      (entry) => entry.participant.discordUserId === scope.actorUserId
    );

    const allowed =
      Boolean(registration) &&
      (!scope.requiredActiveRegistration || registration?.status === RegistrationStatus.ACTIVE);

    await this.auditHook?.onDecision({
      guildId: tournament?.guildId ?? "unknown",
      actorUserId: scope.actorUserId,
      outcome: allowed ? "ALLOWED" : "DENIED",
      action: "participant.scope",
      metadata: {
        tournamentId: scope.tournamentId,
        requiredActiveRegistration: scope.requiredActiveRegistration ?? false
      },
      reason: allowed ? undefined : "Participant registration requirement not satisfied"
    });

    if (!registration) {
      throw new PermissionError("You are not registered for this tournament.");
    }

    if (scope.requiredActiveRegistration && registration.status !== RegistrationStatus.ACTIVE) {
      throw new PermissionError("You must be an active participant to perform this action.");
    }

    return {
      tournamentId: scope.tournamentId,
      registrationId: registration.id,
      participantId: registration.participantId,
      status: registration.status
    };
  }

  public async requireOwner(guildId: string, member: GuildMember, auditAction: string): Promise<void> {
    const context = await this.resolveGuildContext(guildId, member);
    const allowed = context.isGuildOwner || context.mappedRoleTypes.includes(StaffRoleType.OWNER);

    await this.auditHook?.onDecision({
      guildId,
      actorUserId: member.id,
      outcome: allowed ? "ALLOWED" : "DENIED",
      action: auditAction,
      reason: allowed ? undefined : "Guild owner permission required"
    });

    if (!allowed) {
      throw new PermissionError("Only the configured owner may perform this action.");
    }
  }
}
