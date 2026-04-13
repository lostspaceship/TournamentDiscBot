import { REST, Routes } from "discord.js";

import { commandDefinitions } from "../src/commands/catalog.js";
import { env } from "../src/config/env.js";

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

const body = commandDefinitions;

if (env.DISCORD_DEV_GUILD_ID) {
  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID),
    { body }
  );
  console.log(`Registered ${body.length} guild command(s) to ${env.DISCORD_DEV_GUILD_ID}.`);
} else {
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
  console.log(`Registered ${body.length} global command(s).`);
}
