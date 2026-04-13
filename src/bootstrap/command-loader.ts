import { Collection } from "discord.js";

import { commandModules } from "../commands/catalog.js";
import type { CommandModule } from "./types.js";

export const loadCommands = (): Map<string, CommandModule> => {
  const commands = new Collection<string, CommandModule>();

  for (const command of commandModules) {
    commands.set(command.name, command);
  }

  return new Map(commands);
};
