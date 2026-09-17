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
   * `playerId` → equipped body skin at Match end — what the MatchOver
   * podium wears. Sparse like `accountIds`: absent key, default skin.
   * Rows persisted before skins carry no such map; readers default `{}`.
   */
  bodySkins: Record<string, number>;
  /**
   * `playerId` → equipped hat id at Match end (ADR 0083) — the podium wears
   * these too. Sparse: absent key, no hat. Rows persisted before hats carry
   * no such map; readers default `{}`.
   */
  hats: Record<string, string>;
  /** `playerId` → falls across every Round they raced. */
  totalFalls: Record<string, number>;
  endedAtMs: number;
}
