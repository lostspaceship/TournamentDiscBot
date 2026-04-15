export interface BracketSyncTarget {
  syncTournamentBracket(tournamentId: string): Promise<void>;
}
