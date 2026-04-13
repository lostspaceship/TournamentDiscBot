import type { Client } from "discord.js";

import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";

export const registerShutdownHandlers = (client: Client, onClose?: () => Promise<void>) => {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "Shutdown requested");

    try {
      await onClose?.();
      await client.destroy();
      await prisma.$disconnect();
      logger.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Shutdown failed");
      process.exit(1);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
};
