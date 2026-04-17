import type {
  CacheType,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import type pino from "pino";

import type { createHealthServer } from "../http/health.js";
import type { PermissionService } from "../permissions/service.js";
import type { AdminTournamentService } from "../services/admin-tournament-service.js";
import type { BracketSyncService } from "../services/bracket-sync-service.js";
import type { InteractionGuard } from "../services/interaction-guard.js";
import type { MatchReportingService } from "../services/match-reporting-service.js";
import type { RegistrationService } from "../services/registration-service.js";
import type { ViewingService } from "../services/viewing-service.js";
import type { TournamentRepository } from "../repositories/tournament-repository.js";

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
  healthServer: ReturnType<typeof createHealthServer>;
  permissionService: PermissionService;
  interactionGuard: InteractionGuard;
  bracketSyncService: BracketSyncService;
  tournamentRepository: TournamentRepository;
  adminTournamentService: AdminTournamentService;
  registrationService: RegistrationService;
  matchReportingService: MatchReportingService;
  viewingService: ViewingService;
}
