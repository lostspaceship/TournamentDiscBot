import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

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
  DISCORD_DEV_GUILD_ID: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HEALTH_HOST: z.string().min(1).default("127.0.0.1"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3000),
  COMMAND_COOLDOWN_MS: z.coerce.number().int().positive().default(3000)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;
