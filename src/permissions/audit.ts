import { logger } from "../config/logger.js";
import type { PermissionAuditEvent, PermissionAuditHook } from "./types.js";

export class LoggerPermissionAuditHook implements PermissionAuditHook {
  public async onDecision(event: PermissionAuditEvent): Promise<void> {
    const level = event.outcome === "DENIED" ? "warn" : "info";
    logger[level](
      {
        security: {
          type: "permission_decision",
          ...event
        }
      },
      "Permission decision"
    );
  }
}

export class CompositePermissionAuditHook implements PermissionAuditHook {
  public constructor(private readonly hooks: PermissionAuditHook[]) {}

  public async onDecision(event: PermissionAuditEvent): Promise<void> {
    await Promise.all(this.hooks.map((hook) => hook.onDecision(event)));
  }
}
