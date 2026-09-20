import type { EmoteId } from "../cosmetics.js";
import type { RoundResult } from "./Score.js";

/**
 * One finished Match, as the match server persists it (ADR 0059) — the API
 * stores this JSON under `matchId`, and the post-Match results page fetches
 * it back instead of reading a live socket. Written once, at the terminal
 * RESULTS, never mutated.
 *
 * Score stays derived, not stored (ADR 0049): `matchScore`/`matchWinner` over
 * `results` answer totals and the crown, exactly as the old in-canvas
 * Standings did. This carries only what derivation can't recover afterwards:
 * `nicknames` (a dropped Player's `LobbyPlayer` row is gone by Match end, and
 * with it the only place their name lived) and `totalFalls` (the sim only
 * ever holds the current Round's counts).
 */
export interface PersistedMatchResult {
  matchId: string;
  /** Every Round played, in order — the same records the snapshots carried live. */
  results: RoundResult[];
  /**
   * The Track id each Round was raced on, parallel to `results` — what the
   * career history reads to name its rows. Ids, not names: the match server
   * never learns Track names, the API resolves them. Rows saved before this
   * carry no such list; readers default it to `[]`.
   */
  roundTrackIds: string[];
  /** `playerId` → nickname at Match end (or at drop, for Players who left mid-Match). */
  nicknames: Record<string, string>;
  /**
   * `playerId` → Account id, authed Players only (M9 ticket 11 phase 2b) —
   * what RECENT reads to find who you shared a finished Match with.
   * Sparse on purpose: absent key, anonymous seat. Rows persisted before
   * 2b carry no such map at all; readers default it to `{}`.
   */
  accountIds: Record<string, string>;
  /**
   * `playerId` → equipped body color at Match end — what the MatchOver
   * podium wears under no skin. Sparse like `accountIds`: absent key,
   * default color. Rows persisted before colors carry no such map; readers
   * default `{}`.
   */
  colors: Record<string, number>;
  /**
   * `playerId` → equipped skin id at Match end (ADR 0091) — what the podium
   * bean is actually painted with when it has one. Sparse: absent key, no
   * skin, and the bean falls back to its `colors` entry. Rows persisted
   * before skins carry no such map; readers default `{}`.
   */
  skins: Record<string, string>;
  /**
   * `playerId` → equipped hat id at Match end (ADR 0083) — the podium wears
   * these too. Sparse: absent key, no hat. Rows persisted before hats carry
   * no such map; readers default `{}`.
   */
  hats: Record<string, string>;
  /** `playerId` → falls across every Round they raced. */
  totalFalls: Record<string, number>;
  /**
   * `playerId` → the longest they stayed in one Survival Round of this Match,
   * in ms (ADR 0110) — the career's BEST SURVIVAL. Only Players who raced a
   * Survival Round have an entry. Rows persisted before this carry no map;
   * readers default `{}`.
   */
  survivalMs: Record<string, number>;
  /**
   * `playerId` → Struggles they won across the Match (ADR 0104, 0110) — the
   * career's GRABS BROKEN. Sparse: absent key, none. Rows persisted before
   * this carry no map; readers default `{}`.
   */
  grabsBroken: Record<string, number>;
  endedAtMs: number;
}

/**
 * What `GET /matches/:id` answers: the stored result, plus each authed seat's
 * victory pose (ADR 0110) as its Account has it at read time — a signature,
 * not a record, so it is never stored with the Match.
 */
export type MatchResultResponse = PersistedMatchResult & { victoryPoses: Record<string, EmoteId> };
