import { describe, expect, it } from "vitest";

import { DomainConflictError } from "../src/domain/errors.js";
import { TournamentStateMachine } from "../src/domain/tournament/state-machine.js";

describe("TournamentStateMachine", () => {
  const stateMachine = new TournamentStateMachine();

  it("allows a tournament to start directly from open registration", () => {
    const result = stateMachine.transition("REGISTRATION_OPEN", "START", {
      requireCheckIn: false,
      eligibleParticipantCount: 4,
      bracketGenerated: false
    });

    expect(result.to).toBe("IN_PROGRESS");
  });

  it("still rejects start when fewer than two eligible participants are present", () => {
    expect(() =>
      stateMachine.transition("REGISTRATION_OPEN", "START", {
        requireCheckIn: false,
        eligibleParticipantCount: 1,
        bracketGenerated: false
      })
    ).toThrow(DomainConflictError);
  });
});
