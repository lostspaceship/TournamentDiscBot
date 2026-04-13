import pino from "pino";

import { env } from "./env.js";

export const logger = pino({
  name: env.APP_NAME,
  level: env.LOG_LEVEL,
  redact: {
    paths: ["token", "authorization", "password", "headers.authorization"],
    remove: true
  },
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            translateTime: "SYS:standard",
            colorize: true
          }
        }
      : undefined
});
