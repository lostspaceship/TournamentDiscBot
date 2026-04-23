import type { CommandModule } from "../../bootstrap/types.js";
import { alertsCommandDefinition } from "./definition.js";
import { executeAlertsCommand } from "./execute.js";

export const alertsCommand: CommandModule = {
  name: "alerts",
  definition: alertsCommandDefinition,
  execute: executeAlertsCommand
};
