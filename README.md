# Discord Tournament Bot

Production-oriented Discord tournament bot built with TypeScript, `discord.js` v14, Node.js 22+, PostgreSQL, Prisma ORM, Zod validation, Pino logging, and Vitest.

## Architecture Summary

- Discord transport is isolated in [`src/commands/tournament-command.ts`](C:/Users/Faton/Documents/TournamentBot/src/commands/tournament-command.ts), [`src/interactions/router.ts`](C:/Users/Faton/Documents/TournamentBot/src/interactions/router.ts), and [`scripts/register-commands.ts`](C:/Users/Faton/Documents/TournamentBot/scripts/register-commands.ts).
- Business rules live in [`src/services/tournament-service.ts`](C:/Users/Faton/Documents/TournamentBot/src/services/tournament-service.ts), with state always validated against PostgreSQL-backed records.
- Bracket logic is transport-agnostic in [`src/domain/bracket/engine.ts`](C:/Users/Faton/Documents/TournamentBot/src/domain/bracket/engine.ts), so bracket generation and advancement can be tested independently of Discord.
- Prisma models in [`prisma/schema.prisma`](C:/Users/Faton/Documents/TournamentBot/prisma/schema.prisma) store tournaments, registrations, matches, reports, audits, check-ins, and waitlists.
- Abuse resistance is enforced with role checks, idempotency/cooldown guards, optimistic concurrency for match confirmation, server-side validation, audit logging, and content sanitization.

## File Tree

```text
.
|-- .env.example
|-- package.json
|-- prisma
|   |-- migrations
|   |   `-- 202604100001_initial
|   |       `-- migration.sql
|   |-- schema.prisma
|   `-- seed.ts
|-- scripts
|   `-- register-commands.ts
|-- src
|   |-- commands
|   |   |-- registry.ts
|   |   `-- tournament-command.ts
|   |-- config
|   |   |-- env.ts
|   |   |-- logger.ts
|   |   `-- prisma.ts
|   |-- domain
|   |   `-- bracket
|   |       |-- engine.ts
|   |       |-- index.ts
|   |       |-- seeding.ts
|   |       `-- types.ts
|   |-- http
|   |   `-- health.ts
|   |-- interactions
|   |   |-- component-custom-id.ts
|   |   `-- router.ts
|   |-- permissions
|   |   `-- role-permissions.ts
|   |-- repositories
|   |   |-- guild-config-repository.ts
|   |   |-- match-repository.ts
|   |   `-- tournament-repository.ts
|   |-- services
|   |   |-- interaction-guard.ts
|   |   `-- tournament-service.ts
|   |-- types
|   |   `-- bot.ts
|   |-- utils
|   |   |-- async.ts
|   |   |-- discord.ts
|   |   |-- errors.ts
|   |   |-- sanitize.ts
|   |   `-- shutdown.ts
|   `-- validators
|       `-- tournament.ts
|-- tests
|   |-- bracket-engine.test.ts
|   |-- permissions.test.ts
|   `-- registration.test.ts
|-- tsconfig.build.json
|-- tsconfig.json
`-- vitest.config.ts
```

## Features

- Slash-command driven tournament lifecycle.
- Single-elimination and double-elimination bracket generation.
- Byes, deterministic seeding layout, grand finals, and grand finals reset support.
- Registration, withdrawal, check-in, waitlist, mutual exclusion guardrails.
- Match result reporting, opponent confirmation, dispute flow, audit logs.
- Staff role enforcement per guild.
- Health endpoint, structured logging, graceful shutdown, environment-based config.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment settings:

```bash
cp .env.example .env
```

3. Generate Prisma client and apply migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Seed example data if needed:

```bash
npm run db:seed
```

5. Register slash commands:

```bash
npm run register:commands
```

6. Start the bot:

```bash
npm run dev
```

## Environment Variables

- `DISCORD_TOKEN`: bot token.
- `DISCORD_CLIENT_ID`: Discord application ID.
- `DISCORD_DEV_GUILD_ID`: optional guild ID for fast local command registration.
- `DATABASE_URL`: PostgreSQL connection string.
- `LOG_LEVEL`: `fatal|error|warn|info|debug|trace`.
- `HEALTH_PORT`: HTTP health-check port.
- `COMMAND_COOLDOWN_MS`: per-user interaction cooldown.

## Commands

- `/tournament create`
- `/tournament open`
- `/tournament close`
- `/tournament start`
- `/tournament view`
- `/tournament bracket`
- `/tournament participants`
- `/tournament join`
- `/tournament leave`
- `/tournament checkin`
- `/tournament match`
- `/tournament report`
- `/tournament pause`
- `/tournament resume`
- `/tournament cancel`
- `/tournament finalize`
- `/tournament archive`
- `/tournament staffpanel`

## Testing

```bash
npm test
```

The included test suite covers:

- Bracket generation and deterministic advancement.
- Role-based permission checks.
- Registration safeguards such as duplicate prevention and waitlist flow.

## Deployment Notes

- Run the bot behind a process manager such as `systemd`, PM2, or Docker.
- Keep PostgreSQL reachable with regular backups enabled.
- Register commands globally only after validating them in a development guild.
- Keep `NODE_ENV=production`, disable pretty logging in production, and expose `/health` to your orchestrator.
