import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { DomainValidationError } from "../domain/errors.js";

const assertNotPlaceholder = (value: string, name: string): void => {
  if (value === "replace-me") {
    throw new DomainValidationError(`${name} must be set to a real value before startup.`);
  }
};

export const runStartupChecks = async (): Promise<void> => {
  assertNotPlaceholder(env.DISCORD_TOKEN, "DISCORD_TOKEN");
  assertNotPlaceholder(env.DISCORD_CLIENT_ID, "DISCORD_CLIENT_ID");

  await prisma.$connect();
};
