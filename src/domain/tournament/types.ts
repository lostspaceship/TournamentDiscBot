export const tournamentStatuses = [
  "DRAFT",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "CHECK_IN",
  "IN_PROGRESS",
  "PAUSED",
  "CANCELLED",
  "FINALIZED",
  "ARCHIVED"
] as const;

export type TournamentStatus = (typeof tournamentStatuses)[number];

export type TournamentAction =
  | "OPEN_REGISTRATION"
  | "CLOSE_REGISTRATION"
  | "OPEN_CHECK_IN"
  | "START"
  | "PAUSE"
  | "RESUME"
  | "CANCEL"
  | "FINALIZE"
  | "ARCHIVE"
  | "REOPEN_REGISTRATION";

export interface TournamentStateContext {
  requireCheckIn: boolean;
  eligibleParticipantCount: number;
  bracketGenerated: boolean;
  canReopenRegistration?: boolean;
}

export interface TournamentTransitionResult {
  from: TournamentStatus;
  action: TournamentAction;
  to: TournamentStatus;
}
