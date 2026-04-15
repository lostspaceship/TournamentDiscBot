import type { BracketSide } from "../domain/bracket/types.js";

export interface BracketRenderMatch {
  id: string;
  side: BracketSide;
  roundNumber: number;
  sequence: number;
  status: string;
  player1Name: string;
  player2Name: string;
  winnerName: string | null;
  nextMatchId: string | null;
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
  page: number;
  totalPages: number;
  pageLabel: string;
  rounds: BracketRenderRound[];
  placeholder?: {
    bracketSize: number;
    startRound: number;
    endRound: number;
    totalRounds: number;
    entrantNames: string[];
  };
}
