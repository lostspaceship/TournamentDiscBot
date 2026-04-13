import type { ChatInputCommandInteraction, GuildMember } from "discord.js";

import type { BotContext } from "../types/bot.js";

export interface CommandDefinition {
  data: any;
  execute: (interaction: ChatInputCommandInteraction, member: GuildMember, bot: BotContext) => Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  public register(command: CommandDefinition): void {
    this.commands.set(command.data.name, command);
  }

  public get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  public list(): CommandDefinition[] {
    return [...this.commands.values()];
  }
}
