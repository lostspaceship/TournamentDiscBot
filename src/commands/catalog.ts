import { tourCommand } from "./tour/index.js";
import { tournamentCommand } from "./tournament/index.js";
import type { CommandModule } from "../bootstrap/types.js";

export const commandModules: CommandModule[] = [tourCommand, tournamentCommand];

export const commandDefinitions = commandModules.map((command) => command.definition.toJSON());
