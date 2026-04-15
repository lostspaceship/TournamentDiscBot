import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const optionalString = z.preprocess(
  (value) => {
    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }
    return value;
  },
  z.string().min(1).optional()
);

if (isTestEnv) {
  process.env.DISCORD_TOKEN ??= "test-token";
  process.env.DISCORD_CLIENT_ID ??= "test-client-id";
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/test_db?schema=public";
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().min(1).default("discord-tournament-bot"),
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_DEV_GUILD_ID: optionalString,
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HEALTH_HOST: z.string().min(1).default("127.0.0.1"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3000),
  COMMAND_COOLDOWN_MS: z.coerce.number().int().positive().default(3000),
  COMMAND_BURST_LIMIT: z.coerce.number().int().positive().default(10),
  COMMAND_BURST_WINDOW_MS: z.coerce.number().int().positive().default(15000),
  GUILD_BURST_LIMIT: z.coerce.number().int().positive().default(60),
  GUILD_BURST_WINDOW_MS: z.coerce.number().int().positive().default(15000),
  INTERACTION_TTL_MS: z.coerce.number().int().positive().default(900000),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(900000)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;
