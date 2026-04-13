import { StaffRoleType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PermissionService } from "../src/permissions/role-permissions.js";

describe("PermissionService", () => {
  it("accepts members with configured tournament staff roles", async () => {
    const service = new PermissionService({
      async listStaffRoles() {
        return [{ roleId: "staff", type: StaffRoleType.TOURNAMENT_STAFF }];
      }
    } as any);

    await expect(
      service.requireRole(
        "guild-1",
        {
          id: "user-1",
          guild: { ownerId: "owner-2" },
          roles: { cache: new Map([["staff", {}]]) },
          permissions: { has: () => false }
        } as any,
        StaffRoleType.TOURNAMENT_STAFF
      )
    ).resolves.toBeUndefined();
  });

  it("rejects members without the required role", async () => {
    const service = new PermissionService({
      async listStaffRoles() {
        return [{ roleId: "staff", type: StaffRoleType.TOURNAMENT_STAFF }];
      }
    } as any);

    await expect(
      service.requireRole(
        "guild-1",
        {
          id: "user-1",
          guild: { ownerId: "owner-2" },
          roles: { cache: new Map() },
          permissions: { has: () => false }
        } as any,
        StaffRoleType.TOURNAMENT_STAFF
      )
    ).rejects.toThrowError(/permission/i);
  });
});
