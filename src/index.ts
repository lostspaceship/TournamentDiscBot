import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createHealthServer } from "./http/health.js";
import { routeInteraction } from "./bootstrap/interaction-router.js";
import { loadCommands } from "./bootstrap/command-loader.js";
import { createDiscordClient } from "./bootstrap/client.js";
import { registerGlobalErrorHandlers } from "./bootstrap/error-handling.js";
import { registerGracefulShutdown } from "./bootstrap/lifecycle.js";
import { runStartupChecks } from "./bootstrap/startup-checks.js";
import type { BootstrapContext } from "./bootstrap/types.js";
import { TournamentRepository } from "./repositories/tournament-repository.js";
import { GuildConfigRepository } from "./repositories/guild-config-repository.js";
import { LoggerPermissionAuditHook } from "./permissions/audit.js";
import { PermissionService } from "./permissions/service.js";
import { AdminTournamentService } from "./services/admin-tournament-service.js";
import { BracketImageRenderer } from "./renderers/bracket-image-renderer.js";
import { BracketSyncService } from "./services/bracket-sync-service.js";
import { InteractionGuard } from "./services/interaction-guard.js";
import { MatchReportingService } from "./services/match-reporting-service.js";
import { RegistrationService } from "./services/registration-service.js";
import { ViewingService } from "./services/viewing-service.js";
import { tournamentViewHandler } from "./interactions/tournament-view-handler.js";
import { tournamentStaffHandler } from "./interactions/tournament-staff-handler.js";
import { tournamentBracketHandler } from "./interactions/tournament-bracket-handler.js";

const runtime: BootstrapContext["runtime"] = {
  startedAt: new Date(),
  readyAt: null,
  isShuttingDown: false
};

const client = createDiscordClient();
const commands = loadCommands();
const tournamentRepository = new TournamentRepository();
const guildConfigRepository = new GuildConfigRepository();
const permissionService = new PermissionService(
  guildConfigRepository,
  tournamentRepository,
  new LoggerPermissionAuditHook()
);
const interactionGuard = new InteractionGuard();
const bracketSyncService = new BracketSyncService(
  client,
  logger,
  tournamentRepository,
  guildConfigRepository,
  new BracketImageRenderer()
);
const adminTournamentService = new AdminTournamentService(
  guildConfigRepository,
  tournamentRepository,
  bracketSyncService
);
const registrationService = new RegistrationService(tournamentRepository, bracketSyncService);
const matchReportingService = new MatchReportingService(tournamentRepository, bracketSyncService);
const viewingService = new ViewingService(tournamentRepository);
const interactionHandlers: BootstrapContext["interactionHandlers"] = [
  tournamentViewHandler,
  tournamentStaffHandler,
  tournamentBracketHandler
];
const healthServer = createHealthServer({
  logger,
  runtime,
  client
});

const context: BootstrapContext = {
  client,
  logger,
  commands,
  interactionHandlers,
  runtime,
  healthServer,
  permissionService,
  interactionGuard,
  bracketSyncService,
  tournamentRepository,
  adminTournamentService,
  registrationService,
  matchReportingService,
  viewingService
};

registerGlobalErrorHandlers(context);

await runStartupChecks();

client.once("clientReady", () => {
  runtime.readyAt = new Date();
  logger.info(
    {
      user: client.user?.tag,
      commandCount: commands.size
    },
    "Discord client ready"
  );
});

client.on("interactionCreate", async (interaction) => {
  await routeInteraction(interaction, context);
});

const httpServer = await healthServer.listen({
  host: env.HEALTH_HOST,
  port: env.HEALTH_PORT
});

logger.info({ address: httpServer }, "Health server listening");

registerGracefulShutdown(context, client);

await client.login(env.DISCORD_TOKEN);
