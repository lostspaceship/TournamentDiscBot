import type { TournamentCommandContext } from "../helpers.js";
import { parseInput } from "../helpers.js";
import { tournamentIdSchema } from "../../../validators/command-schemas.js";
import {
  buildParticipantsComponents,
  buildParticipantsEmbed
} from "../../../utils/tournament-view-ui.js";

export const handleRegistrationGroup = async (
  command: TournamentCommandContext
): Promise<boolean> => {
  const { interaction, context, guildId, member } = command;

  if (interaction.options.getSubcommandGroup(false) !== "registration") {
    return false;
  }

  const subcommand = interaction.options.getSubcommand(true);
  const { tournamentId } = parseInput(tournamentIdSchema, {
    tournamentId: interaction.options.getString("tournament_id", true)
  });
  const displayName = member.displayName ?? interaction.user.username;

  switch (subcommand) {
    case "join": {
      const result = await context.registrationService.joinTournament({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id,
        displayName
      });

      await interaction.reply({
        content: result.waitlisted
          ? `Tournament is full. You were added to the waitlist at position ${result.waitlistPosition}.`
          : "You have successfully joined the tournament.",
        ephemeral: true
      });
      return true;
    }

    case "leave": {
      const result = await context.registrationService.leaveTournament({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id
      });

      await interaction.reply({
        content: result.leftWaitlist
          ? "You were removed from the waitlist."
          : "You have successfully left the tournament.",
        ephemeral: true
      });
      return true;
    }

    case "checkin": {
      await context.registrationService.checkIn({
        guildId,
        tournamentId,
        actorUserId: interaction.user.id
      });

      await interaction.reply({
        content: "Check-in recorded successfully.",
        ephemeral: true
      });
      return true;
    }

    case "participants": {
      const view = await context.viewingService.getParticipantsPage(guildId, tournamentId, 1);

      await interaction.reply({
        embeds: [buildParticipantsEmbed(view, "Participants")],
        components: buildParticipantsComponents(view.tournamentId, view.page, view.totalPages, "participants")
      });
      return true;
    }

    case "waitlist": {
      const view = await context.viewingService.getWaitlistPage(guildId, tournamentId, 1);

      await interaction.reply({
        embeds: [buildParticipantsEmbed(view, "Waitlist", false)],
        components: buildParticipantsComponents(view.tournamentId, view.page, view.totalPages, "waitlist")
      });
      return true;
    }

    default:
      return false;
  }
};
