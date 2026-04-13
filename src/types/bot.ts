import type { ChatInputCommandInteraction, GuildMember, InteractionReplyOptions } from "discord.js";

import type { TournamentService } from "../services/tournament-service.js";
import type { InteractionGuard } from "../services/interaction-guard.js";
import type { CommandRegistry } from "../commands/registry.js";

export interface BotContext {
  tournamentService: TournamentService;
  interactionGuard: InteractionGuard;
  commands: CommandRegistry;
}

export interface CommandExecutionContext {
  interaction: ChatInputCommandInteraction;
  member: GuildMember;
  bot: BotContext;
}

export type SafeReply = InteractionReplyOptions & {
  ephemeral?: boolean;
};
