import type { TournamentRepository } from "../repositories/tournament-repository.js";
import {
  buildBracketTabs,
  collectOriginEntrantIds,
  type BracketTabKey,
  MAX_PARTICIPANTS_PER_PAGE
} from "./bracket-paging.js";
import type {
  BracketRenderModel,
  BracketRenderRound,
  BracketRenderTabModel,
  PlacementEntry
} from "./types.js";
import { resolveTournamentBracketSnapshot } from "../services/support/bracket-snapshot.js";

type TournamentWithBracketData = NonNullable<Awaited<ReturnType<TournamentRepository["getTournament"]>>>;
type Snapshot = NonNullable<ReturnType<typeof resolveTournamentBracketSnapshot>["snapshot"]>;
type SnapshotMatch = Snapshot["matches"][string];
type PersistedMatch = TournamentWithBracketData["brackets"][number]["rounds"][number]["matches"][number];

export const buildLiveBracketRenderModel = (
  tournament: TournamentWithBracketData,
  tab: BracketTabKey,
  page: number
): BracketRenderModel => {
  const { snapshot, mode } = resolveTournamentBracketSnapshot(tournament);
  const orderedBracketRegistrations = getOrderedBracketRegistrations(tournament, snapshot, mode);
  const activeRegistrations = orderedBracketRegistrations.filter((entry) => entry.status === "ACTIVE");
  const namesByRegistrationId = new Map(
    tournament.registrations.map((entry) => [entry.id, entry.participant.displayName] as const)
  );
  const persistedMatchById = new Map(
    tournament.brackets
      .flatMap((bracket) => bracket.rounds)
      .flatMap((round) => round.matches)
      .map((match) => [match.id, match] as const)
  );

  const allRounds: BracketRenderRound[] =
    snapshot?.rounds
      .map((round) => ({
        id: round.id,
        side: round.side,
        roundNumber: round.roundNumber,
        name: round.name,
        matches: round.matchIds
          .map((matchId) => {
            const match = snapshot.matches[matchId]!;
            const persistedMatch = persistedMatchById.get(match.id);
            if (shouldHideMatchFromRender(match, persistedMatch, mode)) {
              return null;
            }

            const latestReport =
              persistedMatch?.reports
                .slice()
                .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;

            return {
              id: match.id,
              side: match.side,
              roundNumber: match.roundNumber,
              sequence: match.sequence,
              status: match.status,
              scoreLabel:
                latestReport?.player1Score != null && latestReport?.player2Score != null
                  ? `${latestReport.player1Score}-${latestReport.player2Score}`
                  : null,
              player1Name:
                resolveRenderedSlotName(tournament, snapshot, match, 0, namesByRegistrationId, mode) ?? "",
              player2Name:
                resolveRenderedSlotName(tournament, snapshot, match, 1, namesByRegistrationId, mode) ?? "",
              winnerName: namesByRegistrationId.get(match.winnerId ?? "") ?? null,
              nextMatchId: match.nextMatchId,
              originEntrantIds: collectOriginEntrantIds(snapshot, match),
              displayEntrantIds: match.slots
                .map((slot) => slot.entrantId)
                .filter((entrantId): entrantId is string => entrantId != null)
            };
          })
          .filter((match): match is NonNullable<typeof match> => match != null)
      }))
      .filter((round) => round.matches.length > 0)
      .sort(
        (left, right) =>
          sideOrder(left.side) - sideOrder(right.side) || left.roundNumber - right.roundNumber
      ) ?? [];
  const visibleRounds = allRounds;

  const placementEntries: PlacementEntry[] = tournament.registrations
    .filter((entry) =>
      entry.placement != null ||
      entry.status === "ACTIVE" ||
      entry.status === "ELIMINATED" ||
      entry.status === "DISQUALIFIED" ||
      entry.status === "DROPPED"
    )
    .sort((left, right) => {
      const leftGroup = left.placement != null || left.status !== "ACTIVE" ? 0 : 1;
      const rightGroup = right.placement != null || right.status !== "ACTIVE" ? 0 : 1;
      if (leftGroup !== rightGroup) {
        return leftGroup - rightGroup;
      }
      const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
      const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
      if (leftPlacement !== rightPlacement) {
        return leftPlacement - rightPlacement;
      }
      return left.participant.displayName.localeCompare(right.participant.displayName);
    })
    .map((entry) => ({
      placement: entry.placement ?? 999,
      label:
        entry.placement != null
          ? `${entry.placement}${ordinalSuffix(entry.placement)}`
          : entry.status === "ACTIVE"
            ? "Alive"
            : "Out",
      displayName: entry.participant.displayName,
      status:
        entry.status === "ACTIVE"
          ? "Still alive"
          : entry.placement != null
            ? "Placed"
            : prettyPlacementStatus(entry.status),
      group: (entry.placement != null || entry.status !== "ACTIVE" ? "PLACED" : "ACTIVE") as
        | "PLACED"
        | "ACTIVE"
    }));

  const entrantOrder = orderedBracketRegistrations.map((entry) => entry.id);
  const tabs: BracketRenderTabModel[] =
    visibleRounds.length > 0
      ? buildBracketTabs({
          snapshot,
          mode,
          rounds: visibleRounds,
          placements: placementEntries,
          entrantOrder,
          registrationCount: entrantOrder.length
        })
      : [
          {
            key: "WINNERS" as const,
            label: "Brackets",
            pages: [
              {
                title: "Brackets",
                subtitle: activeRegistrations.length > 0 ? "Live bracket preview" : "Waiting for players",
                rounds: [],
                entrantIds: entrantOrder
              }
            ]
          },
          {
            key: "PLACEMENTS" as const,
            label: "Status",
            pages: [
              {
                title: "Status",
                subtitle: "No placements yet",
                rounds: [],
                entrantIds: [],
                placements: placementEntries
              }
            ]
          }
        ] satisfies BracketRenderTabModel[];

  const selectedTab = tabs.find((entry) => entry.key === tab) ?? tabs[0]!;
  const safePage = Math.min(Math.max(1, page), Math.max(1, selectedTab.pages.length));
  const selectedPage = selectedTab.pages[safePage - 1]!;

  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    status: tournament.status,
    mode,
    updatedLabel: `Updated ${new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    })}`,
    activeTab: selectedTab.key,
    activeTabLabel: selectedTab.label,
    tabs: tabs.map((entry) => ({
      key: entry.key,
      label: entry.label,
      pageCount: entry.pages.length
    })),
    page: safePage,
    totalPages: Math.max(1, selectedTab.pages.length),
    registrationCount: entrantOrder.length,
    pageModel: selectedPage,
    placeholder:
      selectedPage.rounds.length === 0 && !selectedPage.placements
        ? {
            bracketSize: projectedBracketSize(entrantOrder.length),
            entrantNames: orderedBracketRegistrations
              .slice(0, MAX_PARTICIPANTS_PER_PAGE)
              .map((entry) => entry.participant.displayName)
          }
        : undefined
  };
};

const getOrderedBracketRegistrations = (
  tournament: TournamentWithBracketData,
  snapshot: ReturnType<typeof resolveTournamentBracketSnapshot>["snapshot"],
  mode: "OFFICIAL" | "PREVIEW" | "NONE"
) => {
  const eligibleStatuses = new Set(["ACTIVE", "ELIMINATED", "DISQUALIFIED", "DROPPED"]);
  const snapshotEntrantIds = new Set<string>(
    snapshot == null
      ? []
      : Object.values(snapshot.matches).flatMap((match) =>
          match.slots.flatMap((slot) => (slot.entrantId ? [slot.entrantId] : []))
        )
  );

  const registrations = tournament.registrations
    .filter((entry) => {
      if (mode === "OFFICIAL") {
        return snapshotEntrantIds.has(entry.id) || entry.seed != null;
      }

      return eligibleStatuses.has(entry.status);
    })
    .sort((left, right) => {
      const leftSeed = left.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
      const rightSeed = right.seed?.seedNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftSeed !== rightSeed) return leftSeed - rightSeed;
      return left.joinedAt.getTime() - right.joinedAt.getTime();
    });

  return registrations.length > 0 ? registrations : tournament.registrations;
};

const sideOrder = (side: BracketRenderRound["side"]): number => {
  if (side === "WINNERS") return 0;
  if (side === "LOSERS") return 1;
  return 2;
};

const projectedBracketSize = (registrationCount: number): number => {
  const minimumSize = MAX_PARTICIPANTS_PER_PAGE;
  const desiredSize = Math.max(minimumSize, registrationCount <= 1 ? 2 : registrationCount);
  let size = 1;
  while (size < desiredSize) {
    size *= 2;
  }

  return size;
};

const ordinalSuffix = (value: number): string => {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return "th";
  }
  switch (value % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
};

const resolveRenderedSlotName = (
  tournament: TournamentWithBracketData,
  snapshot: Snapshot,
  match: SnapshotMatch,
  slotIndex: 0 | 1,
  namesByRegistrationId: Map<string, string>,
  mode: "OFFICIAL" | "PREVIEW" | "NONE"
): string | null => {
  const slot = match.slots[slotIndex];
  if (!slot?.entrantId) {
    return null;
  }

  if (mode === "PREVIEW") {
    return slot.sourceMatchId == null ? namesByRegistrationId.get(slot.entrantId) ?? null : null;
  }

  if (!slot.sourceMatchId) {
    return namesByRegistrationId.get(slot.entrantId) ?? null;
  }

  const sourceMatch = snapshot.matches[slot.sourceMatchId];
  const persistedSourceMatch = tournament.brackets
    .flatMap((bracket) => bracket.rounds)
    .flatMap((round) => round.matches)
    .find((entry) => entry.id === slot.sourceMatchId);

  if (!sourceMatch || !persistedSourceMatch) {
    return null;
  }

  const hasRealAdvance =
    sourceMatch.status === "COMPLETED" &&
    sourceMatch.winnerId === slot.entrantId;

  return hasRealAdvance ? namesByRegistrationId.get(slot.entrantId) ?? null : null;
};

const previewStatusForMatch = (match: SnapshotMatch): string => {
  const entrantCount = match.slots.filter((slot) => slot.entrantId != null).length;
  return entrantCount >= 2 ? "READY" : "PENDING";
};

const shouldHideMatchFromRender = (
  match: SnapshotMatch,
  persistedMatch: PersistedMatch | undefined,
  mode: "OFFICIAL" | "PREVIEW" | "NONE"
): boolean => {
  const entrantCount = match.slots.filter((slot) => slot.entrantId != null).length;
  const hasStructuralFeed = match.slots.some((slot) => slot.sourceMatchId != null);
  const isImplicitBye =
    entrantCount <= 1 &&
    match.status === "COMPLETED" &&
    (persistedMatch == null || persistedMatch.reports.length === 0);

  if (isImplicitBye) {
    return entrantCount === 0;
  }

  if (mode === "PREVIEW") {
    return entrantCount === 0 && !hasStructuralFeed;
  }

  return entrantCount === 0 && !hasStructuralFeed;
};

const prettyPlacementStatus = (status: string): string => {
  switch (status) {
    case "DISQUALIFIED":
      return "Disqualified";
    case "DROPPED":
      return "Dropped";
    case "ELIMINATED":
      return "Eliminated";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
};
