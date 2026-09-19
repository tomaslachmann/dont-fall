import { apiGet, apiPost } from "./base.js";

/**
 * The client's half of `/bets/*` — spectator wagering (ticket 14). The
 * panel polls the board (pools move with every other spectator's ticket)
 * and posts stakes; the match server opens and settles Rounds on its own
 * calls, never through here.
 */
export interface BettingRunnerState {
  playerId: string;
  nickname: string;
  pool: number;
  /** Nothing divides the pool yet when nobody backed this runner — the panel renders a dash. */
  odds: number | undefined;
}

export interface BettingRecentBet {
  /** The bettor's Account — whose avatar the ticker shows (ADR 0110). */
  accountId: string;
  nickname: string;
  amount: number;
  targetNickname: string;
  placedAtMs: number;
}

export interface BettingState {
  matchId: string;
  round: number;
  open: boolean;
  closesAtMs: number;
  settled: boolean;
  winnerIds: string[] | null;
  runners: BettingRunnerState[];
  totalPool: number;
  bettorCount: number;
  recentBets: BettingRecentBet[];
}

export interface PlacedBet {
  betId: string;
  /** The balance right after the debit — what the panel's bean count becomes. */
  coins: number;
}

/** Stakes beans on one runner — one ticket, debited immediately, win or lose. */
export const placeBet = (ticket: {
  matchId: string;
  round: number;
  targetId: string;
  amount: number;
}): Promise<PlacedBet> => apiPost<PlacedBet>("/bets", ticket);

/** One Round's board, live pools/odds and ticker. */
export const getBettingState = (matchId: string, round: number): Promise<BettingState> =>
  apiGet<BettingState>(`/bets/${matchId}/${round}`);
