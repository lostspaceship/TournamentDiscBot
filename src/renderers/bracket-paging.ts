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
  displayEntrantIds: string[];
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
  group: "PLACED" | "ACTIVE";
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

  const winnersPages = buildSidePages("WINNERS", "Winners", winnersRounds, input.entrantOrder, input.mode);
  if (winnersPages.length > 0) {
    tabs.push({ key: "WINNERS", label: "Brackets", pages: relabelPages("Brackets", winnersPages) });
  }

  const losersPages = buildSidePages("LOSERS", "Losers", losersRounds, input.entrantOrder, input.mode);
  if (losersPages.length > 0) {
    tabs.push({ key: "LOSERS", label: "Losers", pages: relabelPages("Losers", losersPages) });
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
    label: "Status",
    pages: buildPlacementPages(input.placements)
  });

  return tabs.filter((tab) => tab.pages.length > 0);
};

const buildSidePages = (
  side: "WINNERS" | "LOSERS",
  label: string,
  rounds: BracketPagingRound[],
  entrantOrder: string[],
  mode: "OFFICIAL" | "PREVIEW" | "NONE"
): BracketRenderPageModel[] => {
  if (rounds.length === 0) {
    return [];
  }

  if (side === "WINNERS" || mode === "PREVIEW") {
    return [
      {
        title: label,
        subtitle: mode === "PREVIEW" ? "Live bracket preview" : "Full bracket",
        rounds: normalizeRounds(rounds),
        entrantIds: uniqueEntrants(rounds)
      }
    ];
  }

  const anchorRound = rounds[0];
  if (!anchorRound) {
    return [];
  }

  const anchorNeedsSplit = anchorRound.matches.length > MAX_MATCHES_PER_PAGE;
  const entrantNeedsSplit = uniqueDisplayedEntrants(rounds).length > MAX_PARTICIPANTS_PER_PAGE;
  if (!anchorNeedsSplit && !entrantNeedsSplit) {
    return [
      {
        title: label,
        subtitle: "Full bracket",
        rounds,
        entrantIds: uniqueEntrants(rounds)
      }
    ];
  }

  const anchorBlocks = chunkAnchorRound(anchorRound.matches);
  const pages = anchorBlocks.map((anchorMatches, pageIndex) => {
    const pageEntrantIds = [
      ...new Set(anchorMatches.flatMap((match) => match.originEntrantIds))
    ];
    const pageRounds = normalizeRounds(
      rounds
        .map((round) => ({
          ...round,
          matches: round.matches.filter((match) =>
            match.originEntrantIds.length > 0 &&
            match.originEntrantIds.every((entrantId) => pageEntrantIds.includes(entrantId))
          )
        }))
        .filter((round) => round.matches.length > 0)
    );

    return {
      title: `${label} Page ${pageIndex + 1}`,
      subtitle: entrantRangeLabel(pageIndex, entrantOrder.length),
      rounds: pageRounds,
      entrantIds: uniqueEntrants(pageRounds)
    };
  });

  const merged = mergeSparsePages(pages);
  return relabelPages(label, merged);
};

const buildFinalsPages = (
  rounds: BracketPagingRound[],
  entrantOrder: string[],
  mode: "OFFICIAL" | "PREVIEW" | "NONE",
  registrationCount: number
): BracketRenderPageModel[] => {
  const finalsRounds = rounds.filter((round) => round.side === "GRAND_FINALS");
  const combinedRounds = normalizeRounds([...finalsRounds]);
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
        title: "Status",
        subtitle: "No placements yet",
        rounds: [],
        entrantIds: [],
        placements: []
      }
    ];
  }

  const activeEntries = placements.filter((entry) => entry.group === "ACTIVE");
  const placedEntries = placements.filter((entry) => entry.group === "PLACED");
  const orderedEntries = [...activeEntries, ...placedEntries];
  const pages: BracketRenderPageModel[] = [];
  for (let index = 0; index < orderedEntries.length; index += 16) {
    const pagePlacements = orderedEntries.slice(index, index + 16);
    pages.push({
      title: pages.length === 0 ? "Status" : `Status Page ${pages.length + 1}`,
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

const uniqueEntrants = (rounds: Array<{ matches: BracketPagingMatch[] }>): string[] =>
  [...new Set(rounds.flatMap((round) => round.matches.flatMap((match) => match.originEntrantIds)))];

const uniqueDisplayedEntrants = (rounds: Array<{ matches: BracketPagingMatch[] }>): string[] =>
  [
    ...new Set(
      rounds.flatMap((round) => round.matches.flatMap((match) => match.displayEntrantIds))
    )
  ];

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

    const unionEntrants = new Set([
      ...uniqueDisplayedEntrants(previous.rounds),
      ...uniqueDisplayedEntrants(page.rounds)
    ]);
    const mergedRounds = normalizeRounds([...previous.rounds, ...page.rounds]);
    const anchorMatchCount = mergedRounds[0]?.matches.length ?? 0;

    if (unionEntrants.size <= MAX_PARTICIPANTS_PER_PAGE && anchorMatchCount <= MAX_MATCHES_PER_PAGE) {
      previous.rounds = mergedRounds;
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

const chunkAnchorRound = (matches: BracketPagingMatch[]): BracketPagingMatch[][] => {
  const chunks: BracketPagingMatch[][] = [];
  for (let index = 0; index < matches.length; index += MAX_MATCHES_PER_PAGE) {
    chunks.push(matches.slice(index, index + MAX_MATCHES_PER_PAGE));
  }
  return chunks;
};


const relabelPages = (label: string, pages: BracketRenderPageModel[]): BracketRenderPageModel[] =>
  pages.map((page, index) => ({
    ...page,
    title: pages.length === 1 ? label : `${label} Page ${index + 1}`
  }));

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
