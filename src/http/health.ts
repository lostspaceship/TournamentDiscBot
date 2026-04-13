import Fastify from "fastify";
import type { Client } from "discord.js";
import type pino from "pino";

import { prisma } from "../config/prisma.js";

interface HealthServerOptions {
  logger: pino.Logger;
  runtime: {
    startedAt: Date;
    readyAt: Date | null;
    isShuttingDown: boolean;
  };
  client: Client;
}

export const createHealthServer = ({ logger, runtime, client }: HealthServerOptions) => {
  const app = Fastify({
    loggerInstance: logger
  });

  app.get("/health/live", async () => ({
    ok: true,
    shuttingDown: runtime.isShuttingDown,
    uptimeMs: Date.now() - runtime.startedAt.getTime()
  }));

  app.get("/health/ready", async (_request, reply) => {
    const discordReady = Boolean(client.isReady() && runtime.readyAt);

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.status(503).send({
        ok: false,
        discordReady,
        databaseReady: false,
        shuttingDown: runtime.isShuttingDown
      });
    }

    if (!discordReady || runtime.isShuttingDown) {
      return reply.status(503).send({
        ok: false,
        discordReady,
        databaseReady: true,
        shuttingDown: runtime.isShuttingDown
      });
    }

    return {
      ok: true,
      discordReady: true,
      databaseReady: true,
      shuttingDown: false
    };
  });

  app.get("/health", async (_request, reply) => {
    const discordReady = Boolean(client.isReady() && runtime.readyAt);
    let databaseReady = false;

    try {
      await prisma.$queryRaw`SELECT 1`;
      databaseReady = true;
    } catch {
      databaseReady = false;
    }

    const ok = discordReady && databaseReady && !runtime.isShuttingDown;

    return reply.status(ok ? 200 : 503).send({
      ok,
      appStartedAt: runtime.startedAt.toISOString(),
      appReadyAt: runtime.readyAt?.toISOString() ?? null,
      discordReady,
      databaseReady,
      shuttingDown: runtime.isShuttingDown
    });
  });

  return app;
};
