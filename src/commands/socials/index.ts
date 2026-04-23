import type { CommandModule } from "../../bootstrap/types.js";
import { socialsCommandDefinition } from "./definition.js";
import { executeSocialsCommand } from "./execute.js";

export const socialsCommand: CommandModule = {
  name: "socials",
  definition: socialsCommandDefinition,
  execute: executeSocialsCommand
};
