import type { MatchPhase } from "@dont-fall/shared";

/** Everything the banner reads — all of it straight from the Snapshot (ADR 0040). */
export interface MatchBannerState {
  phase: MatchPhase;
  /** The server's own Countdown, in ms. */
  countdownMsLeft: number;
  connectedPlayers: number;
  /** How many Players this server waits for — its own configured value, not an assumed default. */
  playersToStart: number;
  /** Whether the local Player was Eliminated — the Round ended and they never Qualified (M4 ticket 05). */
  eliminated: boolean;
}

/**
 * The large centred message for the current Match phase, or `null` when the
 * Round should be left alone to be played (M4 ticket 04/05).
 *
 * Every value here is rendered from what the Snapshot carried — the phase, the
 * server's own Countdown, who is connected — never computed locally (ADR
 * 0040). That is what makes two players' "3, 2, 1" the same three seconds
 * rather than two clocks that happen to be close.
 */
export const matchBanner = ({
  phase,
  countdownMsLeft,
  connectedPlayers,
  playersToStart,
  eliminated,
}: MatchBannerState): string | null => {
  switch (phase) {
    case "LOBBY":
      return `waiting for players · ${connectedPlayers}/${playersToStart}`;
    case "COUNTDOWN":
      // `GO!` rather than a bare `0`: the last thing on screen before release
      // should read as the release. The server has already stopped counting.
      return countdownMsLeft <= 0 ? "GO!" : String(Math.ceil(countdownMsLeft / 1000));
    case "RUNNING":
      return null;
    // The Round is over, and the one thing a Player most needs told is that
    // they did not make it (CONTEXT.md: Elimination). Someone who Qualified
    // already has their placement on the HUD.
    case "ROUND_END":
      return eliminated ? "ELIMINATED" : "round over";
    case "RESULTS":
      return eliminated ? "ELIMINATED" : "results";
  }
};
