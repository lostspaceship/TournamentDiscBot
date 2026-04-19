import type { BracketRenderMatch, BracketRenderRound } from "./types.js";

export interface LayoutConstants {
  cardWidth: number;
  cardHeight: number;
  columnGap: number;
  rowGap: number;
  leftPad: number;
  topPad: number;
  rightPad: number;
  bottomPad: number;
  headerHeight: number;
  pageInfoHeight: number;
}

export interface PositionedMatch {
  match: BracketRenderMatch;
  x: number;
  y: number;
  centerY: number;
}

export interface PositionedRound {
  round: BracketRenderRound;
  x: number;
  labelY: number;
  matches: PositionedMatch[];
}

export interface BracketLayoutModel {
  width: number;
  height: number;
  rounds: PositionedRound[];
}

export interface BracketLayoutOptions {
  useStructuredGrid?: boolean;
}

export const buildBracketLayout = (
  rounds: BracketRenderRound[],
  constants: LayoutConstants,
  options: BracketLayoutOptions = {}
): BracketLayoutModel => {
  const roundsWithMatches = rounds.filter((round) => round.matches.length > 0);
  if (roundsWithMatches.length === 0) {
    return {
      width: constants.leftPad + constants.cardWidth + constants.rightPad,
      height:
        constants.headerHeight + constants.pageInfoHeight + constants.topPad + constants.cardHeight + constants.bottomPad,
      rounds: []
    };
  }

  const minimumCenterGap = constants.cardHeight + constants.rowGap;
  const topOrigin = constants.headerHeight + constants.pageInfoHeight + constants.topPad;
  const positionedRounds: Array<PositionedRound | undefined> = new Array(roundsWithMatches.length);
  const positionsByMatchId = new Map<string, { centerY: number }>();
  const anchorRoundIndex = options.useStructuredGrid
    ? roundsWithMatches.reduce(
        (bestIndex, round, index, source) =>
          round.matches.length > source[bestIndex]!.matches.length ? index : bestIndex,
        0
      )
    : 0;
  const virtualAnchorSlots = options.useStructuredGrid
    ? nextPowerOfTwo(roundsWithMatches[anchorRoundIndex]?.matches.length ?? 1)
    : 0;

  const positionRound = (roundIndex: number): void => {
    const round = roundsWithMatches[roundIndex]!;
    const x = constants.leftPad + roundIndex * (constants.cardWidth + constants.columnGap);
    let idealCenters: number[];

    if (!options.useStructuredGrid) {
      idealCenters =
        roundIndex === 0
          ? round.matches.map((_, matchIndex) => topOrigin + constants.cardHeight / 2 + matchIndex * minimumCenterGap)
          : round.matches.map((match, matchIndex) =>
              resolveIdealCenter(match, roundsWithMatches[roundIndex - 1]?.matches ?? [], positionsByMatchId) ??
              topOrigin + constants.cardHeight / 2 + matchIndex * minimumCenterGap
            );
    } else if (roundIndex >= anchorRoundIndex) {
      idealCenters = round.matches.map((_, matchIndex) =>
        resolveStructuredGridCenter(
          matchIndex + 1,
          roundIndex - anchorRoundIndex,
          virtualAnchorSlots,
          topOrigin,
          constants.cardHeight,
          minimumCenterGap
        )
      );
    } else {
      idealCenters = resolvePreAnchorCenters(
        round.matches,
        roundsWithMatches[roundIndex + 1]?.matches ?? [],
        positionsByMatchId,
        minimumCenterGap,
        topOrigin + constants.cardHeight / 2
      );
    }

    const compactCenters =
      options.useStructuredGrid && roundIndex < anchorRoundIndex
        ? preserveExactAlignedCenters(idealCenters, topOrigin + constants.cardHeight / 2)
        : compactCentersPreservingOrder(idealCenters, minimumCenterGap, topOrigin + constants.cardHeight / 2);
    const matches = round.matches.map((match, matchIndex) => {
      const centerY = compactCenters[matchIndex]!;
      positionsByMatchId.set(match.id, { centerY });
      return {
        match,
        x,
        y: centerY - constants.cardHeight / 2,
        centerY
      };
    });

    positionedRounds[roundIndex] = {
      round,
      x,
      labelY: constants.headerHeight + constants.pageInfoHeight + 6,
      matches
    };
  };

  if (!options.useStructuredGrid) {
    roundsWithMatches.forEach((_, roundIndex) => positionRound(roundIndex));
  } else {
    for (let roundIndex = anchorRoundIndex; roundIndex < roundsWithMatches.length; roundIndex += 1) {
      positionRound(roundIndex);
    }

    for (let roundIndex = anchorRoundIndex - 1; roundIndex >= 0; roundIndex -= 1) {
      positionRound(roundIndex);
    }
  }

  const finalizedRounds = positionedRounds.filter((round): round is PositionedRound => round != null);

  const maxBottom = Math.max(
    ...finalizedRounds.flatMap((round) => round.matches.map((match) => match.y + constants.cardHeight))
  );

  return {
    width:
      constants.leftPad +
      finalizedRounds.length * constants.cardWidth +
      Math.max(0, finalizedRounds.length - 1) * constants.columnGap +
      constants.rightPad,
    height: maxBottom + constants.bottomPad,
    rounds: finalizedRounds
  };
};

const resolvePreAnchorCenters = (
  matches: BracketRenderMatch[],
  nextRoundMatches: BracketRenderMatch[],
  positionsByMatchId: Map<string, { centerY: number }>,
  minimumCenterGap: number,
  fallbackStartCenterY: number
): number[] => {
  const nextMatchCenterById = new Map(
    nextRoundMatches.map((match) => [match.id, positionsByMatchId.get(match.id)?.centerY ?? fallbackStartCenterY] as const)
  );
  const groupedByNextMatch = new Map<string | null, BracketRenderMatch[]>();

  for (const match of matches) {
    const key = match.nextMatchId ?? null;
    const group = groupedByNextMatch.get(key) ?? [];
    group.push(match);
    groupedByNextMatch.set(key, group);
  }

  const centerByMatchId = new Map<string, number>();
  for (const [nextMatchId, group] of groupedByNextMatch.entries()) {
    const targetCenter = nextMatchId != null
      ? nextMatchCenterById.get(nextMatchId) ?? fallbackStartCenterY
      : fallbackStartCenterY;
    const offsetBase = (group.length - 1) / 2;
    group
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .forEach((match, index) => {
        centerByMatchId.set(match.id, targetCenter + (index - offsetBase) * minimumCenterGap);
      });
  }

  return matches.map((match, index) => centerByMatchId.get(match.id) ?? fallbackStartCenterY + index * minimumCenterGap);
};

const resolveIdealCenter = (
  match: BracketRenderMatch,
  previousRoundMatches: BracketRenderMatch[],
  positionsByMatchId: Map<string, { centerY: number }>
): number | null => {
  const sourceCenters = previousRoundMatches
    .filter((entry) => entry.nextMatchId === match.id)
    .map((entry) => positionsByMatchId.get(entry.id)?.centerY)
    .filter((entry): entry is number => entry != null)
    .sort((left, right) => left - right);

  if (sourceCenters.length === 0) {
    return null;
  }

  if (sourceCenters.length === 1) {
    return sourceCenters[0]!;
  }

  return (sourceCenters[0]! + sourceCenters[sourceCenters.length - 1]!) / 2;
};

const compactCentersPreservingOrder = (
  idealCenters: number[],
  minimumGap: number,
  minimumCenterY: number
): number[] => {
  if (idealCenters.length === 0) {
    return [];
  }

  const centers = [...idealCenters];
  centers[0] = Math.max(centers[0]!, minimumCenterY);

  for (let index = 1; index < centers.length; index += 1) {
    centers[index] = Math.max(centers[index]!, centers[index - 1]! + minimumGap);
  }

  const totalIdeal = idealCenters.reduce((sum, value) => sum + value, 0);
  const totalActual = centers.reduce((sum, value) => sum + value, 0);
  const drift = (totalActual - totalIdeal) / centers.length;

  if (drift > 0) {
    for (let index = centers.length - 1; index >= 0; index -= 1) {
      const previous = index === 0 ? minimumCenterY : centers[index - 1]! + minimumGap;
      centers[index] = Math.max(previous, centers[index]! - drift);
    }
  }

  return centers;
};

const preserveExactAlignedCenters = (
  idealCenters: number[],
  minimumCenterY: number
): number[] => {
  if (idealCenters.length === 0) {
    return [];
  }

  const minimumIdeal = Math.min(...idealCenters);
  const shift = Math.max(0, minimumCenterY - minimumIdeal);
  return idealCenters.map((center) => center + shift);
};

const resolveStructuredGridCenter = (
  sequence: number,
  roundIndex: number,
  virtualRoundOneSlots: number,
  topOrigin: number,
  cardHeight: number,
  minimumCenterGap: number
): number => {
  const safeSequence = Math.max(1, sequence);
  const roundBlockSize = 2 ** roundIndex;
  const roundCapacity = Math.max(1, Math.ceil(virtualRoundOneSlots / roundBlockSize));
  const clampedSequence = Math.min(safeSequence, roundCapacity);
  const centerSlot = (clampedSequence - 1) * roundBlockSize + (roundBlockSize - 1) / 2;

  return topOrigin + cardHeight / 2 + centerSlot * minimumCenterGap;
};

const nextPowerOfTwo = (value: number): number => {
  let size = 1;
  while (size < Math.max(1, value)) {
    size *= 2;
  }

  return size;
};
