export const bracketFormats = ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION"] as const;
export type BracketFormat = (typeof bracketFormats)[number];

export const seedingMethods = ["RANDOM", "MANUAL", "RATING_BASED"] as const;
export type SeedingMethod = (typeof seedingMethods)[number];

export const bracketSides = ["WINNERS", "LOSERS", "GRAND_FINALS"] as const;
export type BracketSide = (typeof bracketSides)[number];

export const bracketMatchStatuses = ["PENDING", "READY", "COMPLETED", "CANCELLED"] as const;
export type BracketMatchStatus = (typeof bracketMatchStatuses)[number];

export interface Entrant {
  id: string;
  seed?: number;
  rating?: number | null;
  metadata?: Record<string, unknown>;
}

export interface SeededEntrant extends Entrant {
  seed: number;
}

export interface MatchSlot {
  entrantId: string | null;
  sourceMatchId: string | null;
  sourceOutcome: "WINNER" | "LOSER" | null;
  isBye: boolean;
}

export interface MatchNode {
  id: string;
  side: BracketSide;
  roundNumber: number;
  sequence: number;
  bestOf: number;
  status: BracketMatchStatus;
  slots: [MatchSlot, MatchSlot];
  winnerId: string | null;
  loserId: string | null;
  nextMatchId: string | null;
  nextMatchSlot: 0 | 1 | null;
  loserNextMatchId: string | null;
  loserNextMatchSlot: 0 | 1 | null;
  resetOfMatchId: string | null;
}

export interface RoundNode {
  id: string;
  side: BracketSide;
  roundNumber: number;
  name: string;
  matchIds: string[];
}

export interface BracketSnapshot {
  format: BracketFormat;
  rounds: RoundNode[];
  matches: Record<string, MatchNode>;
  championId: string | null;
  isFinalized: boolean;
  metadata: {
    hasGrandFinalReset: boolean;
    initialEntrantCount: number;
    bracketSize: number;
  };
}

export interface GenerateBracketInput {
  entrants: SeededEntrant[];
  bestOf: number;
  grandFinalResetEnabled?: boolean;
}

export interface ReportMatchOutcomeInput {
  matchId: string;
  winnerId: string;
  loserId: string;
}

export interface BracketAdvanceResult {
  snapshot: BracketSnapshot;
  completedMatch: MatchNode;
  changedMatchIds: string[];
  championId: string | null;
  finalized: boolean;
}

export interface PlacementGroup {
  placement: number;
  entrantIds: string[];
  reason: string;
}

export interface PlacementHookContext {
  snapshot: BracketSnapshot;
  eliminationOrder: string[];
  championId: string | null;
}

export interface PlacementHook {
  calculate(context: PlacementHookContext): PlacementGroup[];
}

export interface BracketEngine {
  readonly format: BracketFormat;
  generate(input: GenerateBracketInput): BracketSnapshot;
  advance(snapshot: BracketSnapshot, input: ReportMatchOutcomeInput): BracketAdvanceResult;
  calculatePlacements(snapshot: BracketSnapshot, hook?: PlacementHook): PlacementGroup[];
}
