# TournamentDiscBot

TournamentDiscBot is a production-oriented Discord tournament bot for running competitive events inside Discord with slash commands, persistent server-side state, audit logging, and a transport-agnostic bracket engine.

It is designed for moderation-heavy tournament workflows where correctness matters more than flashy behavior. Registration, match reporting, confirmation, disputes, bracket advancement, and staff actions are validated against PostgreSQL-backed state on every write.

## What The Bot Does

- Creates and configures tournaments from Discord slash commands
- Supports single elimination and double elimination brackets
- Handles registration, withdrawal, check-in, and waitlists
- Generates deterministic brackets with byes and seeding support
- Lets players report results and requires opponent confirmation by default
- Supports disputes and moderator result overrides
- Supports moderator manual advancement with audit logging
- Auto-advances the bracket when results are confirmed
- Generates and refreshes a tracked bracket image message when the bracket or preview changes
- Exposes public tournament/bracket views and ephemeral staff/player views
- Stores audit logs for sensitive actions
- Survives restarts because all critical state is persisted in PostgreSQL

## Tech Stack

- Node.js 22+
- TypeScript
- [discord.js v14](https://discord.js.org/)
- PostgreSQL
- [Prisma ORM](https://www.prisma.io/)
- [Zod](https://zod.dev/) for input validation
- [Pino](https://getpino.io/) for structured logging
- [Vitest](https://vitest.dev/) for tests
- Fastify for health checks

## Project Layout

```text
src/
  bootstrap/      Discord startup, routing, lifecycle
  commands/       Slash command definitions and handlers
  config/         Env parsing, logger, Prisma client
  domain/         Pure tournament and bracket logic
  http/           Health endpoints
  interactions/   Signed component handling
  permissions/    Role resolution and permission guards
  renderers/      SVG/PNG bracket rendering
  repositories/   Database access helpers
  services/       Application use cases
  utils/          UI helpers, sanitization, errors
  validators/     Zod schemas for command inputs

prisma/
  schema.prisma
  migrations/
  seed.ts

scripts/
  register-commands.ts

tests/
  bracket-engine.test.ts
  permissions.test.ts
  registration.test.ts
```

## Setup

1. Install Node.js 22+ and PostgreSQL.
2. Clone the repository.
3. Install dependencies:

```bash
npm install
```

4. Copy the example environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

5. Fill in the Discord and database values in `.env`.
6. Generate the Prisma client:

```bash
npm run prisma:generate
```

7. Apply database migrations:

```bash
npm run prisma:migrate
```

8. Optionally seed local development data:

```bash
npm run db:seed
```

9. Register slash commands:

```bash
npm run register:commands
```

10. Start the bot:

```bash
npm run dev
```

## Discord App Setup

Create a Discord application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).

Required steps:

1. Create a new application.
2. Add a bot user.
3. Copy the bot token into `DISCORD_TOKEN`.
4. Copy the application ID into `DISCORD_CLIENT_ID`.
5. Invite the bot to your server with the permissions listed below.

For local development, also set `DISCORD_DEV_GUILD_ID` so command registration happens in one development guild instead of waiting for global command propagation.

## Required Bot Permissions And Intents

### Gateway intents

- `Guilds`

### Recommended bot permissions

- `View Channels`
- `Send Messages`
- `Embed Links`
- `Use Slash Commands`
- `Read Message History`
- `Add Reactions`

The current command flow is slash-command driven, so broad text-message permissions are not needed.

## Environment Variables

Current environment variables are parsed in [src/config/env.ts](C:/Users/Faton/Documents/TournamentBot/src/config/env.ts).

Required:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DATABASE_URL`

Optional / operational:

- `NODE_ENV`
- `APP_NAME`
- `DISCORD_DEV_GUILD_ID`
- `LOG_LEVEL`
- `HEALTH_HOST`
- `HEALTH_PORT`
- `COMMAND_COOLDOWN_MS`
- `COMMAND_BURST_LIMIT`
- `COMMAND_BURST_WINDOW_MS`
- `GUILD_BURST_LIMIT`
- `GUILD_BURST_WINDOW_MS`
- `INTERACTION_TTL_MS`
- `IDEMPOTENCY_TTL_MS`

Example:

```env
NODE_ENV=development
APP_NAME=tournament-disc-bot
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_DEV_GUILD_ID=your-dev-guild-id
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tournament_bot?schema=public
LOG_LEVEL=info
HEALTH_HOST=127.0.0.1
HEALTH_PORT=3000
COMMAND_COOLDOWN_MS=3000
COMMAND_BURST_LIMIT=10
COMMAND_BURST_WINDOW_MS=15000
GUILD_BURST_LIMIT=60
GUILD_BURST_WINDOW_MS=15000
INTERACTION_TTL_MS=900000
IDEMPOTENCY_TTL_MS=900000
```

## Database Setup

This bot uses PostgreSQL with Prisma migrations.

Create a database first, then point `DATABASE_URL` at it.

Example local connection string:

```text
postgresql://postgres:postgres@localhost:5432/tournament_bot?schema=public
```

Generate the client:

```bash
npm run prisma:generate
```

Apply migrations:

```bash
npm run prisma:migrate
```

For local development only, you can use:

```bash
npm run prisma:dev
```

## Migrations

Prisma migration files live in [prisma/migrations](C:/Users/Faton/Documents/TournamentBot/prisma/migrations).

Typical workflow:

1. Edit [prisma/schema.prisma](C:/Users/Faton/Documents/TournamentBot/prisma/schema.prisma)
2. Create a development migration:

```bash
npm run prisma:dev
```

3. Commit the generated migration files
4. In production, apply them with:

```bash
npm run prisma:migrate
```

## Command Registration

Slash command registration is handled by [scripts/register-commands.ts](C:/Users/Faton/Documents/TournamentBot/scripts/register-commands.ts).

Run:

```bash
npm run register:commands
```

Behavior:

- If `DISCORD_DEV_GUILD_ID` is set, commands can be registered to one guild for fast iteration
- Otherwise commands can be registered globally depending on the script configuration and environment

## Current Command Surface

Primary command surface:

- `/tour create`
- `/tour config`
- `/tour open`
- `/tour close`
- `/tour start`
- `/tour join`
- `/tour leave`
- `/tour checkin`
- `/tour view`
- `/tour participants`
- `/tour bracket`
- `/tour match`
- `/tour report`
- `/tour confirm`
- `/tour dispute`
- `/tour advance`
- `/tour dq`
- `/tour drop`
- `/tour reseed`
- `/tour cancel`
- `/tour finish`
- `/tour staff`
- `/tour settings`

Compatibility alias:

- `/tournament ...`

The shorter `/tour` command is the intended operator UX. The older grouped `/tournament` command remains registered as a compatibility path.

## Tournament Lifecycle Notes

- Registration stays open until staff explicitly starts the tournament.
- The bracket can be previewed before start and grows dynamically as entrants join.
- The official bracket is generated and locked at `/tour start`.
- Odd entrant counts are padded with byes automatically.
- Double elimination loser routing, grand finals, and grand finals reset are handled in the pure domain bracket engine.

## Bracket Image Updates

- The bot renders the current bracket or pre-start preview to a server-side PNG.
- If `GuildConfig.tournamentAnnouncementChannelId` is configured, the bot posts or edits a tracked bracket message in that channel.
- The image is refreshed after:
  - joins and leaves that change the preview
  - tournament start
  - reseeding
  - confirmed results
  - staff overrides
  - manual staff advancement
- Rendering failures are logged and do not roll back tournament state changes.

## Local Development

Start in watch mode:

```bash
npm run dev
```

Useful commands:

```bash
npm run lint
npm test
npm run prisma:generate
npm run prisma:dev
npm run register:commands
```

Development recommendations:

- use a dedicated Discord test guild
- use `DISCORD_DEV_GUILD_ID` for fast command propagation
- keep a local Postgres instance separate from production
- avoid reusing production bot tokens in development

## Health Checks

The bot exposes HTTP health endpoints via Fastify.

Available endpoints:

- `/health`
- `/health/live`
- `/health/ready`

These are implemented in [src/http/health.ts](C:/Users/Faton/Documents/TournamentBot/src/http/health.ts) and are intended for container platforms, process supervisors, or load balancers.

## Production Deployment Guidance

Use a supervised process or container runtime. Good options include:

- Docker
- systemd
- PM2
- Fly.io / Railway / Render / Kubernetes

Production checklist:

- run with `NODE_ENV=production`
- use a managed PostgreSQL instance with backups
- set strong, environment-specific secrets
- expose the health endpoint to your orchestrator
- run migrations before or during deploy
- register slash commands from CI or a controlled deploy step
- monitor logs for permission denials, repeated conflicts, and interaction failures

Typical deployment flow:

1. build or install dependencies
2. run `npm run prisma:generate`
3. run `npm run prisma:migrate`
4. run `npm run register:commands`
5. start the bot with `npm run start`

## Security Notes

This bot is intentionally defensive.

Current protections include:

- server-side validation for tournament state and permissions
- PostgreSQL-backed state, no critical in-memory tournament state
- signed interaction payloads for buttons and menus
- interaction TTL checks to reject stale component usage
- command cooldowns and burst rate limits
- idempotency protections for repeated interaction delivery
- optimistic concurrency and row locking around sensitive writes
- duplicate join and duplicate result processing protection
- user-controlled text sanitization to remove mass mentions
- audit logs for sensitive moderator and tournament actions
- ephemeral responses for sensitive player and staff information
- tracked bracket-message updates happen after DB commit so Discord failures do not corrupt state

Important operational note:
The bot disables automatic mention parsing at the Discord client level, so user content does not turn into `@everyone`, `@here`, or role/user pings unless you explicitly change that behavior.

## Testing

Run the full test suite:

```bash
npm test
```

Run TypeScript validation:

```bash
npm run lint
```

Current tests cover:

- bracket engine generation and advancement
- tournament start transition rules
- pre-start bracket preview generation
- manual advance validation
- bracket image sync behavior
- permission logic
- registration flows

As the bot grows, add more service-level tests around:

- match reporting races
- moderator overrides
- stale interaction rejection
- audit logging behavior

## Troubleshooting

### Commands do not appear in Discord

- verify `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`
- re-run `npm run register:commands`
- if using global commands, wait for propagation
- for development, prefer `DISCORD_DEV_GUILD_ID`

### Database errors on startup

- verify `DATABASE_URL`
- ensure PostgreSQL is reachable
- run `npm run prisma:generate`
- run `npm run prisma:migrate`

### Health endpoint says not ready

- check bot login success
- check database connectivity
- inspect structured logs from startup and interaction routing

## Future Extension Ideas

- team-based tournaments
- Swiss or round-robin formats
- richer bracket rendering as images or web views
- scheduled check-in reminders and match reminders
- staff moderation undo flows with compensating transactions
- player rating integrations for real seeding
- richer dashboard components and modal-based admin flows
- analytics for participation, no-shows, and match completion times
- webhook or external API integration for tournament exports

## License

Add a license file before public redistribution if you intend to open-source the project.
