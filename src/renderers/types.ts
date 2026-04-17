import type { BracketSide } from "../domain/bracket/types.js";
import type {
  BracketRenderPageModel,
  BracketRenderTabModel,
  BracketTabKey,
  PlacementEntry
} from "./bracket-paging.js";

export type { BracketRenderPageModel, BracketRenderTabModel, BracketTabKey, PlacementEntry };

export interface BracketRenderMatch {
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

export interface BracketRenderRound {
  id: string;
  side: BracketSide;
  roundNumber: number;
  name: string;
  matches: BracketRenderMatch[];
}

export interface BracketRenderModel {
  tournamentId: string;
  tournamentName: string;
  status: string;
  mode: "OFFICIAL" | "PREVIEW" | "NONE";
  updatedLabel: string;
  registrationCount: number;
  activeTab: BracketTabKey;
  activeTabLabel: string;
  page: number;
  totalPages: number;
  tabs: Array<{
    key: BracketTabKey;
    label: string;
    pageCount: number;
  }>;
  pageModel: BracketRenderPageModel;
  placeholder?: {
    bracketSize: number;
    entrantNames: string[];
  };
}
