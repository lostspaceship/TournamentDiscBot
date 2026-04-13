import { PrismaClient } from "@prisma/client";

import { logger } from "./logger.js";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma__ ??
  new PrismaClient({
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" }
    ]
  });

prisma.$on("error" as never, (event: any) => {
  logger.error({ prisma: event }, "Prisma error");
});

prisma.$on("warn" as never, (event: any) => {
  logger.warn({ prisma: event }, "Prisma warning");
});

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma__ = prisma;
}
