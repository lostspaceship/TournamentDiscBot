import { StaffRoleType } from "@prisma/client";

export const permissionRank: Record<StaffRoleType, number> = {
  OWNER: 4,
  ADMIN: 3,
  MODERATOR: 2,
  TOURNAMENT_STAFF: 1
};

export const modOnlyActions = new Set([
  "staff.dq",
  "staff.drop",
  "staff.override",
  "staff.undo",
  "staff.remove"
]);

export const staffActions = new Set([
  "lifecycle.create",
  "lifecycle.config",
  "lifecycle.open",
  "lifecycle.close",
  "lifecycle.start",
  "lifecycle.pause",
  "lifecycle.resume",
  "lifecycle.cancel",
  "lifecycle.finalize",
  "lifecycle.archive",
  "staff.panel",
  "staff.advance",
  "staff.forcejoin",
  "staff.reseed",
  "staff.remake"
]);

export const participantActions = new Set([
  "registration.join",
  "registration.leave",
  "registration.checkin",
  "match.view",
  "match.report",
  "match.confirm",
  "match.dispute"
]);
