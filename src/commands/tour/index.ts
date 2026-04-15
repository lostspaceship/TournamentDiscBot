import type { CommandModule } from "../../bootstrap/types.js";
import { tourCommandDefinition } from "./definition.js";
import { executeTourCommand } from "./execute.js";

export const tourCommand: CommandModule = {
  name: "tour",
  definition: tourCommandDefinition,
  execute: executeTourCommand
};
