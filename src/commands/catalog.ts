import { tourCommand } from "./tour/index.js";
import type { CommandModule } from "../bootstrap/types.js";

export const commandModules: CommandModule[] = [tourCommand];

export const commandDefinitions = commandModules.map((command) => command.definition.toJSON());
