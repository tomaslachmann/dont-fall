import type { MatchPhase } from "@dont-fall/shared";

/** Everything the banner reads — all of it straight from the Snapshot (ADR 0040). */
export interface MatchBannerState {
  phase: MatchPhase;
  connectedPlayers: number;
  /** How many Players this server waits for — its own configured value, not an assumed default. */
  playersToStart: number;
  /** Whether the local Player was Eliminated — the Round ended and they never Qualified (M4 ticket 05). */
  eliminated: boolean;
  /**
   * Who this eliminated client is following in Spectator Mode (M7 ticket
   * 07) — set only while the camera is on somebody else, `undefined`
   * whenever it is on your own Character. A playing Round is still left
   * alone to be played: only a spectator ever sees a banner here.
   */
  spectatingNickname?: string;
}

/**
 * The large centred message for the current Match phase, or `null` when the
 * Round should be left alone to be played (M4 ticket 04/05).
 *
 * Every value here is rendered from what the Snapshot carried — never
 * computed locally (ADR 0040).
 */
export const matchBanner = ({
  phase,
  connectedPlayers,
  playersToStart,
  eliminated,
  spectatingNickname,
}: MatchBannerState): string | null => {
  switch (phase) {
    case "LOBBY":
      return `waiting for players · ${connectedPlayers}/${playersToStart}`;
    // The React Countdown overlay owns the count (and the green GO!) — a
    // canvas banner underneath it would double every beat.
    case "COUNTDOWN":
      return null;
    case "RUNNING":
      return spectatingNickname === undefined ? null : `SPECTATING ${spectatingNickname} · C for next`;
    // The Round is over, and the one thing a Player most needs told is that
    // they did not make it (CONTEXT.md: Elimination). Someone who Qualified
    // already has their placement on the HUD.
    case "ROUND_END":
      return eliminated ? "ELIMINATED" : "round over";
    case "RESULTS":
      return eliminated ? "ELIMINATED" : "results";
  }
};
