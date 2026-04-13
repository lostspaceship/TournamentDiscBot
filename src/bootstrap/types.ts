import type {
  CacheType,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import type { FastifyInstance } from "fastify";
import type pino from "pino";

import type { PermissionService } from "../permissions/service.js";
import type { AdminTournamentService } from "../services/admin-tournament-service.js";
import type { MatchReportingService } from "../services/match-reporting-service.js";
import type { RegistrationService } from "../services/registration-service.js";

export interface RuntimeState {
  startedAt: Date;
  readyAt: Date | null;
  isShuttingDown: boolean;
}

export interface CommandModule {
  name: string;
  definition: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction<CacheType>, context: BootstrapContext): Promise<void>;
}

export interface InteractionHandlerModule {
  id: string;
  canHandle(interaction: Interaction): boolean;
  handle(interaction: Interaction, context: BootstrapContext): Promise<void>;
}

export interface BootstrapContext {
  client: Client;
  logger: pino.Logger;
  commands: Map<string, CommandModule>;
  interactionHandlers: InteractionHandlerModule[];
  runtime: RuntimeState;
  healthServer: FastifyInstance;
  permissionService: PermissionService;
  adminTournamentService: AdminTournamentService;
  registrationService: RegistrationService;
  matchReportingService: MatchReportingService;
}
