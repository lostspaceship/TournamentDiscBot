import { DomainConflictError, DomainValidationError } from "../errors.js";
import type {
  TournamentAction,
  TournamentStateContext,
  TournamentStatus,
  TournamentTransitionResult
} from "./types.js";

export class TournamentStateMachine {
  public canTransition(
    current: TournamentStatus,
    action: TournamentAction,
    context: TournamentStateContext
  ): boolean {
    try {
      this.transition(current, action, context);
      return true;
    } catch {
      return false;
    }
  }

  public transition(
    current: TournamentStatus,
    action: TournamentAction,
    context: TournamentStateContext
  ): TournamentTransitionResult {
    const to = this.resolveNextState(current, action, context);
    return { from: current, action, to };
  }

  private resolveNextState(
    current: TournamentStatus,
    action: TournamentAction,
    context: TournamentStateContext
  ): TournamentStatus {
    switch (action) {
      case "OPEN_REGISTRATION":
        this.assert(
          current === "DRAFT" || current === "REGISTRATION_CLOSED",
          "Registration can only be opened from draft or closed state."
        );
        return "REGISTRATION_OPEN";

      case "REOPEN_REGISTRATION":
        this.assert(current === "REGISTRATION_CLOSED", "Only closed registration can be reopened.");
        this.assert(Boolean(context.canReopenRegistration), "Registration reopening is disabled.");
        this.assert(!context.bracketGenerated, "Registration cannot be reopened after bracket generation.");
        return "REGISTRATION_OPEN";

      case "CLOSE_REGISTRATION":
        this.assert(current === "REGISTRATION_OPEN", "Registration is not open.");
        return context.requireCheckIn ? "CHECK_IN" : "REGISTRATION_CLOSED";

      case "OPEN_CHECK_IN":
        this.assert(current === "REGISTRATION_OPEN", "Check-in can only open while registration is open.");
        this.assert(context.requireCheckIn, "Check-in is not enabled for this tournament.");
        return "CHECK_IN";

      case "START":
        this.assert(
          current === "REGISTRATION_OPEN" ||
            current === "REGISTRATION_CLOSED" ||
            current === "CHECK_IN",
          "Tournament can only start while registration is open, closed, or in check-in."
        );
        this.assert(
          context.eligibleParticipantCount >= 2,
          "At least two eligible participants are required to start."
        );
        return "IN_PROGRESS";

      case "PAUSE":
        this.assert(current === "IN_PROGRESS", "Only in-progress tournaments can be paused.");
        return "PAUSED";

      case "RESUME":
        this.assert(current === "PAUSED", "Only paused tournaments can be resumed.");
        return "IN_PROGRESS";

      case "CANCEL":
        this.assert(
          current !== "ARCHIVED" && current !== "FINALIZED" && current !== "CANCELLED",
          "This tournament can no longer be cancelled."
        );
        return "CANCELLED";

      case "FINALIZE":
        this.assert(
          current === "IN_PROGRESS" || current === "PAUSED",
          "Only active tournaments can be finalized."
        );
        this.assert(context.bracketGenerated, "Tournament cannot be finalized before bracket generation.");
        return "FINALIZED";

      case "ARCHIVE":
        this.assert(
          current === "FINALIZED" || current === "CANCELLED",
          "Only finalized or cancelled tournaments can be archived."
        );
        return "ARCHIVED";

      default:
        throw new DomainValidationError(`Unsupported tournament action: ${String(action)}`);
    }
  }

  private assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
      throw new DomainConflictError(message);
    }
  }
}
