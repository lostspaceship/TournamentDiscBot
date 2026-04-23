import { alertsCommand } from "./alerts/index.js";
import { rulesCommand } from "./rules/index.js";
import { socialsCommand } from "./socials/index.js";
import { tourCommand } from "./tour/index.js";
import type { CommandModule } from "../bootstrap/types.js";

export const commandModules: CommandModule[] = [tourCommand, rulesCommand, socialsCommand, alertsCommand];

export const commandDefinitions = commandModules.map((command) => command.definition.toJSON());
