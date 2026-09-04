import type { MatchPhase } from "@dont-fall/shared";

/**
 * The large centred message for the current Match phase, or `null` when the
 * Round should be left alone to be played (M4 ticket 04).
 *
 * Every value here is rendered from what the Snapshot carried — the phase and
 * the server's own Countdown — never computed locally (ADR 0040). That is
 * what makes two players' "3, 2, 1" the same three seconds rather than two
 * clocks that happen to be close.
 */
export const matchBanner = (
  phase: MatchPhase,
  countdownMsLeft: number,
  connectedPlayers: number,
  playersToStart: number,
): string | null => {
  switch (phase) {
    case "LOBBY":
      return `waiting for players · ${connectedPlayers}/${playersToStart}`;
    case "COUNTDOWN":
      // `GO!` rather than a bare `0`: the last thing on screen before release
      // should read as the release. The server has already stopped counting.
      return countdownMsLeft <= 0 ? "GO!" : String(Math.ceil(countdownMsLeft / 1000));
    case "RUNNING":
      return null;
    case "ROUND_END":
      return "round over";
    case "RESULTS":
      return "results";
  }
};
