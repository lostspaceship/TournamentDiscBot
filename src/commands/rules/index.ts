import type { CommandModule } from "../../bootstrap/types.js";
import { rulesCommandDefinition } from "./definition.js";
import { executeRulesCommand } from "./execute.js";

export const rulesCommand: CommandModule = {
  name: "rules",
  definition: rulesCommandDefinition,
  execute: executeRulesCommand
};
