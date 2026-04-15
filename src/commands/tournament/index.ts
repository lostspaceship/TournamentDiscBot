import type { CommandModule } from "../../bootstrap/types.js";
import { tournamentCommandDefinition } from "./definition.js";
import { executeTournamentCommand } from "./execute.js";

export const tournamentCommand: CommandModule = {
  name: "tournament",
  definition: tournamentCommandDefinition,
  execute: executeTournamentCommand
};
