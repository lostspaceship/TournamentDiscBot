import type {
  SlashCommandChannelOption,
  SlashCommandBooleanOption,
  SlashCommandIntegerOption,
  SlashCommandStringOption,
  SlashCommandSubcommandBuilder,
  SlashCommandUserOption
} from "discord.js";

export const addTournamentIdOption = (
  subcommand: SlashCommandSubcommandBuilder,
  description = "Tournament name or slug"
): SlashCommandSubcommandBuilder =>
  subcommand.addStringOption((option) =>
    option.setName("tournament_id").setDescription(description).setRequired(true)
  );

export const addRequiredReasonOption = (
  subcommand: SlashCommandSubcommandBuilder,
  description: string
): SlashCommandSubcommandBuilder =>
  subcommand.addStringOption((option) =>
    option.setName("reason").setDescription(description).setRequired(true).setMaxLength(250)
  );

export const stringOption = (
  name: string,
  description: string,
  required = false
) => (option: SlashCommandStringOption): SlashCommandStringOption =>
  option.setName(name).setDescription(description).setRequired(required);

export const intOption = (
  name: string,
  description: string,
  options?: {
    minValue?: number;
    maxValue?: number;
    required?: boolean;
  }
) => (option: SlashCommandIntegerOption): SlashCommandIntegerOption => {
  option.setName(name).setDescription(description).setRequired(options?.required ?? false);
  if (options?.minValue != null) option.setMinValue(options.minValue);
  if (options?.maxValue != null) option.setMaxValue(options.maxValue);
  return option;
};

export const boolOption = (
  name: string,
  description: string,
  required = false
) => (option: SlashCommandBooleanOption): SlashCommandBooleanOption =>
  option.setName(name).setDescription(description).setRequired(required);

export const userOption = (
  name: string,
  description: string,
  required = false
) => (option: SlashCommandUserOption): SlashCommandUserOption =>
  option.setName(name).setDescription(description).setRequired(required);

export const channelOption = (
  name: string,
  description: string,
  required = false
) => (option: SlashCommandChannelOption): SlashCommandChannelOption =>
  option.setName(name).setDescription(description).setRequired(required);
