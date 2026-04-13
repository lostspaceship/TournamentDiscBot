import type {
  BracketAdvanceResult,
  BracketEngine,
  BracketSnapshot,
  MatchNode,
  PlacementGroup,
  PlacementHook,
  ReportMatchOutcomeInput
} from "./types.js";
import {
  cloneSnapshot,
  listEliminationOrder,
  refreshMatchState,
  requireMatch,
  validateReport
} from "./helpers.js";

export abstract class BaseBracketEngine implements BracketEngine {
  public abstract readonly format: BracketSnapshot["format"];

  public abstract generate(input: Parameters<BracketEngine["generate"]>[0]): BracketSnapshot;

  public advance(snapshot: BracketSnapshot, input: ReportMatchOutcomeInput): BracketAdvanceResult {
    const next = cloneSnapshot(snapshot);
    const changedMatchIds = new Set<string>();
    const match = requireMatch(next, input.matchId);

    validateReport(match, input.winnerId, input.loserId);
    match.winnerId = input.winnerId;
    match.loserId = input.loserId;
    match.status = "COMPLETED";
    changedMatchIds.add(match.id);

    this.routeWinner(next, match, changedMatchIds);
    this.routeLoser(next, match, changedMatchIds);
    this.propagateAutoWins(next, changedMatchIds);
    this.resolveFinalization(next, match, changedMatchIds);

    return {
      snapshot: next,
      completedMatch: requireMatch(next, match.id),
      changedMatchIds: [...changedMatchIds],
      championId: next.championId,
      finalized: next.isFinalized
    };
  }

  public calculatePlacements(snapshot: BracketSnapshot, hook?: PlacementHook): PlacementGroup[] {
    const eliminationOrder = listEliminationOrder(snapshot);
    if (hook) {
      return hook.calculate({
        snapshot,
        eliminationOrder,
        championId: snapshot.championId
      });
    }

    const placements: PlacementGroup[] = [];
    if (snapshot.championId) {
      placements.push({ placement: 1, entrantIds: [snapshot.championId], reason: "Champion" });
    }

    eliminationOrder.forEach((entrantId, index) => {
      placements.push({
        placement: index + 2,
        entrantIds: [entrantId],
        reason: "Eliminated"
      });
    });

    return placements;
  }

  protected abstract routeWinner(
    snapshot: BracketSnapshot,
    match: MatchNode,
    changedMatchIds: Set<string>
  ): void;

  protected abstract routeLoser(
    snapshot: BracketSnapshot,
    match: MatchNode,
    changedMatchIds: Set<string>
  ): void;

  protected abstract resolveFinalization(
    snapshot: BracketSnapshot,
    completedMatch: MatchNode,
    changedMatchIds: Set<string>
  ): void;

  protected propagateAutoWins(snapshot: BracketSnapshot, changedMatchIds: Set<string>): void {
    const queue = Object.values(snapshot.matches)
      .filter((match) => match.status === "COMPLETED" && match.winnerId)
      .map((match) => match.id);

    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const current = snapshot.matches[currentId];
      if (!current || current.status !== "COMPLETED" || !current.winnerId) {
        continue;
      }

      this.routeWinner(snapshot, current, changedMatchIds);
      this.routeLoser(snapshot, current, changedMatchIds);

      for (const targetId of [current.nextMatchId, current.loserNextMatchId]) {
        if (!targetId) {
          continue;
        }

        const target = snapshot.matches[targetId];
        if (!target) {
          continue;
        }

        refreshMatchState(target);
        if (target.status === "COMPLETED") {
          changedMatchIds.add(target.id);
          queue.push(target.id);
          if (target.winnerId) {
            this.routeWinner(snapshot, target, changedMatchIds);
          }
          if (target.loserId) {
            this.routeLoser(snapshot, target, changedMatchIds);
          }
        }
      }
    }
  }
}
