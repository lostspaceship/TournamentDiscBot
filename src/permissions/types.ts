import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  ModalSubmitInteraction,
  StringSelectMenuInteraction
} from "discord.js";
import type { StaffRoleType } from "@prisma/client";

export type GuardedInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction
  | StringSelectMenuInteraction;

export interface GuildPermissionContext {
  guildId: string;
  guildOwnerId: string;
  member: GuildMember;
  mappedRoleTypes: StaffRoleType[];
  isGuildOwner: boolean;
  isDiscordAdministrator: boolean;
}

export interface ParticipantScope {
  tournamentId: string;
  actorUserId: string;
  requiredActiveRegistration?: boolean;
}

export interface ParticipantAccessResult {
  tournamentId: string;
  registrationId: string;
  participantId: string;
  status: string;
}

export interface PermissionAuditEvent {
  guildId: string;
  actorUserId: string;
  outcome: "ALLOWED" | "DENIED";
  action: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionAuditHook {
  onDecision(event: PermissionAuditEvent): Promise<void>;
}
