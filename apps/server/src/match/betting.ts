import { BETTING_CEILING_MS, type RoundResult } from "@dont-fall/shared";

/**
 * The match server's half of spectator wagering (ticket 14): it opens each
 * Round for betting when the Countdown starts and settles it when the Round
 * ends, against the API's `/bets/rounds/*` — the API owns coins and pools,
 * this side only reports roster, close time and winners.
 *
 * Both calls are fire-and-forget from the tick loop (`matchLoop.ts`): a down
 * API closes betting (no round row reads as closed) and strands settlement
 * in the server log, but never the Round. Failures log, never throw.
 */

/** One betting Round, as the API's `POST /bets/rounds/open` expects it. */
export interface BettingRoundOpen {
  matchId: string;
  round: number;
  closesAtMs: number;
  runners: { playerId: string; nickname: string }[];
}

export interface BettingRoundSettle {
  matchId: string;
  round: number;
  winnerIds: string[];
}

/** Closes a Round's board before it settles — one runner is left, so nothing is left to bet on (ADR 0110). */
export interface BettingRoundClose {
  matchId: string;
  round: number;
}

export interface BettingNotifier {
  openRound: (round: BettingRoundOpen) => Promise<void>;
  closeRound: (close: BettingRoundClose) => Promise<void>;
  settleRound: (settle: BettingRoundSettle) => Promise<void>;
}

/**
 * How many Characters are still running this Round — neither out nor across
 * the line. A board stays open while this is at least two (ADR 0110): with one
 * left there is no race to call.
 */
export const runnersLeft = (characters: Record<string, { eliminated: boolean; finishTick: number | null }>): number =>
  Object.values(characters).filter((character) => !character.eliminated && character.finishTick === null).length;

/**
 * Placement-1 rows take the Round — ties share the crown, and their backers
 * share the pool. Reads the same `RoundResult` the standings already
 * reported, never a second ranking.
 */
export const roundWinners = (result: RoundResult): string[] =>
  result.rows.filter((row) => row.placement === 1).map((row) => row.id);

/**
 * The COUNTDOWN-entry hook's arguments, pure so tests pin them without a
 * loop: the Round number counts finished Rounds (round 1 opens with none
 * finished), the ceiling lands `BETTING_CEILING_MS` after now, and sidelined
 * mid-Match spectators (M7 ticket 08 — in the Lobby's list, not in the
 * Round) are not runners anyone can back.
 */
export const openBettingArgs = (args: {
  matchId: string;
  finishedRounds: number;
  players: ReadonlyMap<string, { nickname: string }>;
  sidelined: ReadonlySet<string>;
  nowMs: number;
}): BettingRoundOpen => ({
  matchId: args.matchId,
  round: args.finishedRounds + 1,
  closesAtMs: args.nowMs + BETTING_CEILING_MS,
  runners: [...args.players.entries()]
    .filter(([id]) => !args.sidelined.has(id))
    .map(([playerId, player]) => ({ playerId, nickname: player.nickname })),
});

export const httpBettingNotifier = (
  apiUrl: string,
  fetchFn: typeof fetch = fetch,
  serviceToken: string | undefined = process.env.SERVICE_TOKEN,
): BettingNotifier => {
  const post = async (path: string, body: unknown): Promise<void> => {
    try {
      const res = await fetchFn(`${apiUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Absent (or wrong) the API refuses the call and betting stays
          // closed — the same `SERVICE_TOKEN` env both sides share.
          ...(serviceToken ? { "x-service-token": serviceToken } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) console.error(`DON'T FALL: betting ${path} refused (${res.status}), round unaffected`);
    } catch (err) {
      console.error(`DON'T FALL: betting ${path} unreachable, round unaffected`, err);
    }
  };
  return {
    openRound: (round) => post("/bets/rounds/open", round),
    closeRound: (close) => post("/bets/rounds/close", close),
    settleRound: (settle) => post("/bets/rounds/settle", settle),
  };
};
