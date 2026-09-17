import { matchPlacements, roundScore, type PersistedMatchResult } from "@dont-fall/shared";
import { skinForPlayerId } from "./avatarSkins.js";

/**
 * View mappers: replicated match data in, designed-screen props out. Pure
 * (no sockets, no React), so the shell's tests pin them directly.
 *
 * Two disciplines this module holds. First, it never re-derives what the
 * server already decided: totals, ranks, and winners come off the snapshot
 * as sent (`StandingsRow.score/placement`, `MatchWinner`), and per-Round
 * gains come from score *deltas* against the previous snapshot — never from
 * re-running `roundScore` on a placement the client would have to guess
 * (tier placements aren't continuous, so that would drift from the
 * server's own books). Second, its inputs are structural, not the game's
 * own `StandingsSnapshot`: `lib` must stay neutral in the shell/game split
 * (`codeSplitBoundary.test.ts`), so importing `game/index.ts` types here
 * would be a boundary violation — the shapes below accept them without
 * naming them.
 */

export interface StandingRowInput {
  id: string;
  nickname: string;
  score: number;
  placement: number;
  gone: boolean;
}

export interface StandingRowView {
  name: string;
  skin: ReturnType<typeof skinForPlayerId>;
  gained: number;
  total: number;
  moved?: number;
  you?: boolean;
  out?: boolean;
}

/**
 * One BetweenRounds table: this snapshot's ranked rows against the previous
 * snapshot's totals. `gained` is the exact Score delta (newcomers start from
 * 0); `moved` is the rank climb since last Round (newcomers get none rather
 * than a fake one); `out` is gone-only — a bad Round never eliminates
 * anyone in M7, only a dropped connection takes a Player out of the Match.
 */
export const toStandingRows = (
  current: readonly StandingRowInput[],
  previous: ReadonlyMap<string, { score: number; placement: number }>,
  myId: string | undefined,
): StandingRowView[] =>
  current.map((row) => {
    const prev = previous.get(row.id);
    return {
      name: row.nickname,
      skin: skinForPlayerId(row.id),
      gained: row.score - (prev?.score ?? 0),
      total: row.score,
      ...(prev === undefined ? {} : { moved: prev.placement - row.placement }),
      ...(myId !== undefined && row.id === myId ? { you: true as const } : {}),
      ...(row.gone ? { out: true as const } : {}),
    };
  });

export interface ClaimedRoundRow {
  placement: number;
  playerCount: number;
  score: number;
}

/** `1` → `"1ST"`, `2` → `"2ND"`, `3` → `"3RD"`, the rest `"NTH"` — podium and stat copy. */
export const ordinal = (placement: number): string => {
  const suffix = placement === 1 ? "ST" : placement === 2 ? "ND" : placement === 3 ? "RD" : "TH";
  return `${placement}${suffix}`;
};

export interface MatchTableRow {
  id: string;
  nickname: string;
  score: number;
  placement: number;
  /** Equipped skin at Match end — null for anonymous seats and pre-skins results: the default. */
  bodySkin: number | null;
  /** Equipped hat at Match end (ADR 0083) — null for none, and for pre-hats results. */
  hat: string | null;
}

export interface MatchResultsView {
  /** The final table, champion first — score desc, last-Round placement asc, id asc for a still-tied pair. */
  table: MatchTableRow[];
  /** One Player's own claim rows, oldest Round first — Rounds they never raced are left out, never zero-filled. */
  myRounds: ClaimedRoundRow[];
  /** One Player's own stat line — `null` when they never raced (a spectator) or weren't named. */
  myStats: { wins: number; falls: number; best: number } | null;
  /** The final table as scoreboard rows — `gained` is the last Round's own gain (0 for anyone who sat it out). */
  scoreboard: StandingRowView[];
}

/**
 * One fetched Match in, the results page's props out (ADR 0059) — the same
 * derivation the old in-canvas overlay did live, now over persisted rows.
 * Totals are `matchScore` (never re-summed here); `myId` is whoever's page
 * this is (`?me=`, absent when the arrival didn't name anyone).
 */
export const toMatchResultsView = (
  result: PersistedMatchResult,
  myId: string | undefined,
): MatchResultsView => {
  const lastRound = result.results[result.results.length - 1];
  const table: MatchTableRow[] = matchPlacements(result.results).map((row) => ({
    id: row.id,
    nickname: result.nicknames[row.id] ?? row.id,
    score: row.score,
    placement: row.placement,
    bodySkin: (result.bodySkins ?? {})[row.id] ?? null,
    hat: (result.hats ?? {})[row.id] ?? null,
  }));

  const myRounds: ClaimedRoundRow[] = [];
  let wins = 0;
  let best = Number.POSITIVE_INFINITY;
  if (myId !== undefined) {
    for (const round of result.results) {
      const mine = round.rows.find((row) => row.id === myId);
      if (mine === undefined) continue;
      if (mine.placement === 1) wins += 1;
      best = Math.min(best, mine.placement);
      myRounds.push({
        placement: mine.placement,
        playerCount: round.rows.length,
        score: roundScore(mine.placement, round.rows.length, mine.qualified),
      });
    }
  }

  const scoreboard: StandingRowView[] = table.map((row) => {
    const last = lastRound?.rows.find((r) => r.id === row.id);
    return {
      name: row.nickname,
      skin: skinForPlayerId(row.id),
      gained: last === undefined ? 0 : roundScore(last.placement, lastRound!.rows.length, last.qualified),
      total: row.score,
      ...(myId !== undefined && row.id === myId ? { you: true as const } : {}),
    };
  });

  return {
    table,
    myRounds,
    myStats:
      myRounds.length === 0
        ? null
        : { wins, falls: myId === undefined ? 0 : (result.totalFalls[myId] ?? 0), best },
    scoreboard,
  };
};
