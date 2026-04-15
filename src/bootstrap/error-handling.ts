import { inspect } from "node:util";

import type { BootstrapContext } from "./types.js";

export const registerGlobalErrorHandlers = (context: Pick<BootstrapContext, "logger" | "runtime">): void => {
  process.on("unhandledRejection", (reason) => {
    context.logger.error(
      {
        reason,
        inspectedReason: inspect(reason, { depth: 10 })
      },
      "Unhandled promise rejection"
    );
  });

  process.on("uncaughtException", (error) => {
    context.logger.fatal(
      {
        error,
        inspectedError: inspect(error, { depth: 10 })
      },
      "Uncaught exception"
    );
    context.runtime.isShuttingDown = true;
    process.exitCode = 1;
  });

  process.on("warning", (warning) => {
    context.logger.warn({ warning }, "Process warning");
  });
};
