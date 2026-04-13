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
import { MatchReportingService } from "./services/match-reporting-service.js";
import { RegistrationService } from "./services/registration-service.js";

const runtime = {
  startedAt: new Date(),
  readyAt: null,
  isShuttingDown: false
};

const client = createDiscordClient();
const commands = loadCommands();
const interactionHandlers: BootstrapContext["interactionHandlers"] = [];
const tournamentRepository = new TournamentRepository();
const guildConfigRepository = new GuildConfigRepository();
const permissionService = new PermissionService(
  guildConfigRepository,
  tournamentRepository,
  new LoggerPermissionAuditHook()
);
const adminTournamentService = new AdminTournamentService(
  guildConfigRepository,
  tournamentRepository
);
const registrationService = new RegistrationService(tournamentRepository);
const matchReportingService = new MatchReportingService(tournamentRepository);
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
  adminTournamentService,
  registrationService,
  matchReportingService
};

registerGlobalErrorHandlers(context);

await runStartupChecks();

client.once("ready", () => {
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
