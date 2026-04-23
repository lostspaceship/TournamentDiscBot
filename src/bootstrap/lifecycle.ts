import type { Client } from "discord.js";

import { prisma } from "../config/prisma.js";
import type { BootstrapContext } from "./types.js";

export const registerGracefulShutdown = (
  context: Pick<BootstrapContext, "logger" | "runtime" | "healthServer" | "alertPollingService">,
  client: Client
): void => {
  let closing = false;

  const shutdown = async (signal: string) => {
    if (closing) {
      return;
    }

    closing = true;
    context.runtime.isShuttingDown = true;
    context.logger.info({ signal }, "Shutdown requested");

    try {
      context.alertPollingService.stop();
      await context.healthServer.close();
      await client.destroy();
      await prisma.$disconnect();
      context.logger.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      context.logger.error({ error }, "Shutdown failed");
      process.exit(1);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
};
