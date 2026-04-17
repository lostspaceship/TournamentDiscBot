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

export const buildBracketLayout = (
  rounds: BracketRenderRound[],
  constants: LayoutConstants
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
  const positionedRounds: PositionedRound[] = [];
  const positionsByMatchId = new Map<string, { centerY: number }>();

  roundsWithMatches.forEach((round, roundIndex) => {
    const x = constants.leftPad + roundIndex * (constants.cardWidth + constants.columnGap);
    const idealCenters =
      roundIndex === 0
        ? round.matches.map((_, matchIndex) => topOrigin + constants.cardHeight / 2 + matchIndex * minimumCenterGap)
        : round.matches.map((match, matchIndex) =>
            resolveIdealCenter(match, roundsWithMatches[roundIndex - 1]?.matches ?? [], positionsByMatchId) ??
            topOrigin + constants.cardHeight / 2 + matchIndex * minimumCenterGap
          );

    const compactCenters = compactCentersPreservingOrder(idealCenters, minimumCenterGap, topOrigin + constants.cardHeight / 2);
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

    positionedRounds.push({
      round,
      x,
      labelY: constants.headerHeight + constants.pageInfoHeight + 6,
      matches
    });
  });

  const maxBottom = Math.max(
    ...positionedRounds.flatMap((round) => round.matches.map((match) => match.y + constants.cardHeight))
  );

  return {
    width:
      constants.leftPad +
      positionedRounds.length * constants.cardWidth +
      Math.max(0, positionedRounds.length - 1) * constants.columnGap +
      constants.rightPad,
    height: maxBottom + constants.bottomPad,
    rounds: positionedRounds
  };
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
