
# PebbleHost Deploy

1. Upload the project files to PebbleHost with File Manager or FTP.
2. Do not upload `node_modules`.
3. Make sure your `.env` on Pebble includes:
   `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
4. In the PebbleHost panel, set the Start File to:
   `scripts/pebble-start.js`
5. Start the bot from the Pebble console.

The Pebble start script will:
- generate Prisma client
- build the TypeScript project
- apply database migrations
- start the bot

If you change slash commands later, run:
`npm run register:commands`

Useful commands:
- `npm run lint`
- `npm run test`
- `npm run register:commands`
