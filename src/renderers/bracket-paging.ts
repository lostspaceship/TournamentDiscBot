import type { BracketSide, BracketSnapshot, MatchNode } from "../domain/bracket/types.js";

export const MAX_PARTICIPANTS_PER_PAGE = 16;
export const MAX_MATCHES_PER_PAGE = 8;

export type BracketTabKey = "WINNERS" | "LOSERS" | "FINALS" | "PLACEMENTS";

export interface BracketPagingMatch {
  id: string;
  side: BracketSide;
  roundNumber: number;
  sequence: number;
  status: string;
  player1Name: string;
  player2Name: string;
  winnerName: string | null;
  scoreLabel: string | null;
  nextMatchId: string | null;
  originEntrantIds: string[];
}

export interface BracketPagingRound {
  id: string;
  side: BracketSide;
  roundNumber: number;
  name: string;
  matches: BracketPagingMatch[];
}

export interface PlacementEntry {
  placement: number;
  label: string;
  displayName: string;
  status: string;
}

export interface BracketRenderPageModel {
  title: string;
  subtitle: string;
  rounds: BracketPagingRound[];
  entrantIds: string[];
  placements?: PlacementEntry[];
}

export interface BracketRenderTabModel {
  key: BracketTabKey;
  label: string;
  pages: BracketRenderPageModel[];
}

export const buildBracketTabs = (input: {
  snapshot: BracketSnapshot | null;
  mode: "OFFICIAL" | "PREVIEW" | "NONE";
  rounds: BracketPagingRound[];
  placements: PlacementEntry[];
  entrantOrder: string[];
  registrationCount: number;
}): BracketRenderTabModel[] => {
  const tabs: BracketRenderTabModel[] = [];

  const winnersRounds = input.rounds.filter((round) => round.side === "WINNERS");
  const losersRounds = input.rounds.filter((round) => round.side === "LOSERS");
  const grandFinalRounds = input.rounds.filter((round) => round.side === "GRAND_FINALS");

  const winnersPages = buildSidePages("WINNERS", "Winners", winnersRounds, input.entrantOrder);
  if (winnersPages.length > 0) {
    tabs.push({ key: "WINNERS", label: "Winners", pages: winnersPages });
  }

  const losersPages = buildSidePages("LOSERS", "Losers", losersRounds, input.entrantOrder);
  if (losersPages.length > 0) {
    tabs.push({ key: "LOSERS", label: "Losers", pages: losersPages });
  }

  const finalsPages = buildFinalsPages(input.rounds, input.entrantOrder, input.mode, input.registrationCount);
  if (finalsPages.length > 0) {
    tabs.push({ key: "FINALS", label: "Finals", pages: finalsPages });
  } else if (grandFinalRounds.length > 0) {
    tabs.push({
      key: "FINALS",
      label: "Finals",
      pages: [
        {
          title: "Finals",
          subtitle: "Championship bracket",
          rounds: grandFinalRounds,
          entrantIds: uniqueEntrants(grandFinalRounds)
        }
      ]
    });
  }

  tabs.push({
    key: "PLACEMENTS",
    label: "Placements",
    pages: buildPlacementPages(input.placements)
  });

  return tabs.filter((tab) => tab.pages.length > 0);
};

const buildSidePages = (
  side: "WINNERS" | "LOSERS",
  label: string,
  rounds: BracketPagingRound[],
  entrantOrder: string[]
): BracketRenderPageModel[] => {
  if (rounds.length === 0) {
    return [];
  }

  const sideMatches = rounds.flatMap((round) => round.matches);
  const splitThreshold = Math.ceil(entrantOrder.length / MAX_PARTICIPANTS_PER_PAGE);
  if (splitThreshold <= 1) {
    return [
      {
        title: label,
        subtitle: "Full bracket",
        rounds,
        entrantIds: uniqueEntrants(rounds)
      }
    ];
  }

  const indexByEntrantId = new Map(
    entrantOrder.map((entrantId, index) => [entrantId, index] as const)
  );

  const rootPages = new Map<number, BracketPagingRound[]>();
  const sharedMatchesByRound = new Map<string, BracketPagingRound["matches"]>();

  for (const round of rounds) {
    for (const match of round.matches) {
      const pageKeys = pageKeysForMatch(match, indexByEntrantId);
      if (pageKeys.length === 0) {
        continue;
      }

      if (pageKeys.length > 1) {
        const bucketKey = `${round.id}`;
        const existing = sharedMatchesByRound.get(bucketKey) ?? [];
        sharedMatchesByRound.set(bucketKey, [...existing, match]);
        continue;
      }

      const pageKey = pageKeys[0]!;
      const existingRounds = rootPages.get(pageKey) ?? [];
      const roundIndex = existingRounds.findIndex((entry) => entry.id === round.id);
      if (roundIndex === -1) {
        existingRounds.push({
          ...round,
          matches: [match]
        });
      } else {
        existingRounds[roundIndex] = {
          ...existingRounds[roundIndex]!,
          matches: [...existingRounds[roundIndex]!.matches, match]
        };
      }
      rootPages.set(pageKey, existingRounds);
    }
  }

  const pages = [...rootPages.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([pageKey, pageRounds]) => ({
      title: `${label} Page ${pageKey + 1}`,
      subtitle: entrantRangeLabel(pageKey, entrantOrder.length),
      rounds: normalizeRounds(pageRounds),
      entrantIds: uniqueEntrants(pageRounds)
    }));

  const sharedRounds = normalizeRounds(
    rounds
      .map((round) => ({
        ...round,
        matches: sharedMatchesByRound.get(round.id) ?? []
      }))
      .filter((round) => round.matches.length > 0)
  );

  const merged = mergeSparsePages(pages);
  const split = merged.flatMap((page) => splitDensePage(page));
  if (sharedRounds.length > 0) {
    split.push({
      title: `${label} Finals`,
      subtitle: "Cross-page championship path",
      rounds: sharedRounds,
      entrantIds: uniqueEntrants(sharedRounds)
    });
  }

  return split;
};

const buildFinalsPages = (
  rounds: BracketPagingRound[],
  entrantOrder: string[],
  mode: "OFFICIAL" | "PREVIEW" | "NONE",
  registrationCount: number
): BracketRenderPageModel[] => {
  const finalsRounds = rounds.filter((round) => round.side === "GRAND_FINALS");
  const winnersCrossRounds = rounds
    .filter((round) => round.side === "WINNERS")
    .map((round) => ({
      ...round,
      matches: round.matches.filter((match) => spansMultiplePages(match, entrantOrder))
    }))
    .filter((round) => round.matches.length > 0);
  const losersCrossRounds = rounds
    .filter((round) => round.side === "LOSERS")
    .map((round) => ({
      ...round,
      matches: round.matches.filter((match) => spansMultiplePages(match, entrantOrder))
    }))
    .filter((round) => round.matches.length > 0);

  const combinedRounds = normalizeRounds([...winnersCrossRounds, ...losersCrossRounds, ...finalsRounds]);
  if (combinedRounds.length > 0) {
    return [
      {
        title: "Finals",
        subtitle:
          registrationCount > MAX_PARTICIPANTS_PER_PAGE
            ? "Merged championship path"
            : mode === "PREVIEW"
              ? "Projected finals path"
              : "Championship path",
        rounds: combinedRounds,
        entrantIds: uniqueEntrants(combinedRounds)
      }
    ];
  }

  return [];
};

const buildPlacementPages = (placements: PlacementEntry[]): BracketRenderPageModel[] => {
  if (placements.length === 0) {
    return [
      {
        title: "Placements",
        subtitle: "No placements yet",
        rounds: [],
        entrantIds: [],
        placements: []
      }
    ];
  }

  const pages: BracketRenderPageModel[] = [];
  for (let index = 0; index < placements.length; index += 12) {
    const pagePlacements = placements.slice(index, index + 12);
    pages.push({
      title: pages.length === 0 ? "Placements" : `Placements Page ${pages.length + 1}`,
      subtitle: `${pagePlacements[0]!.label} to ${pagePlacements[pagePlacements.length - 1]!.label}`,
      rounds: [],
      entrantIds: [],
      placements: pagePlacements
    });
  }
  return pages;
};

const normalizeRounds = (rounds: BracketPagingRound[]): BracketPagingRound[] =>
  [...rounds]
    .map((round) => ({
      ...round,
      matches: [...round.matches].sort((left, right) => left.sequence - right.sequence)
    }))
    .sort((left, right) => left.roundNumber - right.roundNumber);

const pageKeysForMatch = (
  match: BracketPagingMatch,
  indexByEntrantId: Map<string, number>
): number[] => {
  const keys = new Set<number>();
  for (const entrantId of match.originEntrantIds) {
    const index = indexByEntrantId.get(entrantId);
    if (index == null) {
      continue;
    }
    keys.add(Math.floor(index / MAX_PARTICIPANTS_PER_PAGE));
  }
  return [...keys].sort((left, right) => left - right);
};

const spansMultiplePages = (
  match: BracketPagingMatch,
  entrantOrder: string[]
): boolean => {
  const indexByEntrantId = new Map(
    entrantOrder.map((entrantId, index) => [entrantId, index] as const)
  );
  return pageKeysForMatch(match, indexByEntrantId).length > 1;
};

const uniqueEntrants = (rounds: Array<{ matches: BracketPagingMatch[] }>): string[] =>
  [...new Set(rounds.flatMap((round) => round.matches.flatMap((match) => match.originEntrantIds)))];

const entrantRangeLabel = (pageIndex: number, totalEntrants: number): string => {
  const start = pageIndex * MAX_PARTICIPANTS_PER_PAGE + 1;
  const end = Math.min(totalEntrants, (pageIndex + 1) * MAX_PARTICIPANTS_PER_PAGE);
  return `Participants ${start}-${end}`;
};

const mergeSparsePages = (pages: BracketRenderPageModel[]): BracketRenderPageModel[] => {
  if (pages.length <= 1) {
    return pages;
  }

  const merged: BracketRenderPageModel[] = [];
  for (const page of pages) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push(page);
      continue;
    }

    const unionEntrants = new Set([...previous.entrantIds, ...page.entrantIds]);
    if (unionEntrants.size <= MAX_PARTICIPANTS_PER_PAGE) {
      previous.rounds = normalizeRounds([...previous.rounds, ...page.rounds]);
      previous.entrantIds = [...unionEntrants];
      previous.subtitle = `${previous.subtitle} + ${page.subtitle}`;
      continue;
    }

    merged.push(page);
  }

  return merged;
};

const splitDensePage = (page: BracketRenderPageModel): BracketRenderPageModel[] => {
  const anchorRound = page.rounds[0];
  if (!anchorRound || anchorRound.matches.length <= MAX_MATCHES_PER_PAGE) {
    return [page];
  }

  const pages: BracketRenderPageModel[] = [];
  for (let start = 0; start < anchorRound.matches.length; start += MAX_MATCHES_PER_PAGE) {
    const anchorMatches = anchorRound.matches.slice(start, start + MAX_MATCHES_PER_PAGE);
    const entrantIds = [...new Set(anchorMatches.flatMap((match) => match.originEntrantIds))];
    const rounds = normalizeRounds(
      page.rounds
        .map((round) => ({
          ...round,
          matches: round.matches.filter((match) =>
            match.originEntrantIds.some((entrantId) => entrantIds.includes(entrantId))
          )
        }))
        .filter((round) => round.matches.length > 0)
    );

    pages.push({
      title: page.title,
      subtitle:
        page.title === "Finals"
          ? page.subtitle
          : `${page.subtitle} | Block ${pages.length + 1}`,
      rounds,
      entrantIds
    });
  }

  return pages;
};

export const collectOriginEntrantIds = (
  snapshot: BracketSnapshot,
  match: MatchNode
): string[] => {
  const originEntrants = new Set<string>();
  const visitSlot = (slot: MatchNode["slots"][number]) => {
    if (slot.sourceMatchId) {
      const sourceMatch = snapshot.matches[slot.sourceMatchId];
      if (sourceMatch) {
        for (const sourceSlot of sourceMatch.slots) {
          visitSlot(sourceSlot);
        }
      }
      return;
    }

    if (slot.entrantId) {
      originEntrants.add(slot.entrantId);
    }
  };

  for (const slot of match.slots) {
    visitSlot(slot);
  }

  return [...originEntrants];
};
