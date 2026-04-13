import { tournamentCommand } from "./definitions/tournament.js";
import type { CommandModule } from "../bootstrap/types.js";

export const commandModules: CommandModule[] = [tournamentCommand];

export const commandDefinitions = commandModules.map((command) => command.definition.toJSON());
