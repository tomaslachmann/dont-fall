import { COUNTDOWN_MS, type MatchPhase } from "@dont-fall/shared";
import { RiseLatch } from "./riseLatch.js";
import type { SoundSlot } from "./slots.js";

/** Time left (ms) at which the Round says "hurry up", once. A Round shorter than this never does. */
export const HURRY_UP_AT_MS = 30_000;
/**
 * How late (ms) a Countdown call may be heard on the frame a client first
 * sees the Countdown. The first COUNTDOWN snapshot arrives a round trip
 * after the Countdown began, and "three" is still due then. A client that
 * joins later than this hears only what is left.
 */
export const LATE_CALL_GRACE_MS = 400;
/**
 * A frame longer than this (ms) of server time plays only the latest call
 * that fell in it: a stalled tab doesn't count "three, two, one" at once.
 */
export const MAX_CALL_STEP_MS = 400;
/**
 * How long after the Standings show (ms) "final round" is said, past their
 * own jingle. The Countdown's first second is already "three".
 */
export const FINAL_ROUND_DELAY_MS = 1_600;

/** The Countdown's calls, by how long before its end each is due. */
export const COUNTDOWN_CALLS: readonly { slot: SoundSlot; beforeEndMs: number }[] = (
  [
    { slot: "match.count_3", beforeEndMs: 3_000 },
    { slot: "match.count_2", beforeEndMs: 2_000 },
    { slot: "match.count_1", beforeEndMs: 1_000 },
    { slot: "match.go", beforeEndMs: 0 },
  ] satisfies { slot: SoundSlot; beforeEndMs: number }[]
).filter((call) => call.beforeEndMs <= COUNTDOWN_MS);

/** Where this client is in the Match, once a frame. */
export interface MatchFrame {
  phase: MatchPhase;
  /** The client's estimate of the server's clock (ms), or `null` before time sync. */
  serverNowMs: number | null;
  /** When the Countdown ends on the server's clock, from the latest COUNTDOWN snapshot. */
  countdownEndsAtMs: number | null;
  timeLeftMs: number | null;
  /** Your own Character as predicted: its Checkpoint (`null` before the first)… */
  checkpointIndex: number | null;
  /** …and whether it has Qualified. */
  qualified: boolean;
  /** Watching someone else: only the Round's end and the Results are heard. */
  spectating: boolean;
  /** At RESULTS, how the Match stands. */
  results: MatchResultsFrame | null;
}

export interface MatchResultsFrame {
  /** No Rounds are left: the Match has a winner. */
  matchOver: boolean;
  /** You are one of the Match's winners, and whether the only one. */
  won: boolean;
  soleWinner: boolean;
  /** One Round is left, the last. */
  finalRoundNext: boolean;
}

/**
 * The Match's voice and jingles (M14 ticket 10, ADR 0087), as the calls due
 * each frame. Pure: the caller plays what comes back.
 *
 * - **Countdown:** "three, two, one, go" (ADR 0040), each at its instant on
 *   the server's clock. The end comes from the snapshot, and the time now is
 *   `TimeSync`'s estimate, never a local timer started on the phase change.
 *   Once its "go" is due, a Countdown is over until the next is entered: the
 *   snapshots still reading COUNTDOWN in the meantime (RUNNING is a one-way
 *   trip away, or a stall rebased the server's clock and moved the end later)
 *   never count it again.
 * - **Hurry up:** once, when the clock passes {@link HURRY_UP_AT_MS}.
 *   **Time over:** when the Round ends with the clock at zero.
 * - **Checkpoint** and **Qualified:** your own, as predicted, the moment the
 *   banner shows.
 * - **Round end:** a jingle on entering ROUND_END.
 * - **Results:** a winner's jingle and "you win" ("congratulations" for a
 *   shared win) when the Match is yours, otherwise a neutral jingle. When one
 *   Round is left, "final round" follows the jingle.
 *
 * It lives as long as the game, not a Stage, so a Track reload replays nothing.
 */
export class MatchCalls {
  private phase: MatchPhase | null = null;
  private lastServerMs: number | null = null;
  private countdownEnd: number | null = null;
  /** This Countdown's "go" has been due: its end is not taken up again. */
  private countdownDone = false;
  private lastTimeLeft: number | null = null;
  private hurried = false;
  private qualified = false;
  private readonly checkpoints = new RiseLatch();
  private finalRoundAt: number | null = null;

  update(frame: MatchFrame): SoundSlot[] {
    const calls: SoundSlot[] = [];
    const entered = frame.phase !== this.phase;
    const previous = this.phase;
    this.phase = frame.phase;
    const now = frame.serverNowMs;

    if (entered && frame.phase === "COUNTDOWN") {
      this.hurried = false;
      this.qualified = false;
      this.finalRoundAt = null;
      this.countdownDone = false;
    }
    if (frame.phase === "LOBBY" || frame.phase === "RESULTS") this.countdownEnd = null;

    // The Countdown, until its "go", even on the frame RUNNING has already begun.
    if (frame.phase === "COUNTDOWN" && frame.countdownEndsAtMs !== null && !this.countdownDone) {
      if (this.countdownEnd === null) this.lastServerMs = null;
      this.countdownEnd = frame.countdownEndsAtMs;
    }
    if (this.countdownEnd !== null && now !== null && !frame.spectating && (frame.phase === "COUNTDOWN" || frame.phase === "RUNNING")) {
      const from = this.lastServerMs ?? now - LATE_CALL_GRACE_MS;
      const due = COUNTDOWN_CALLS.filter(({ beforeEndMs }) => {
        const at = this.countdownEnd! - beforeEndMs;
        return at > from && at <= now;
      });
      const stale = now - from > MAX_CALL_STEP_MS;
      calls.push(...(stale ? due.slice(-1) : due).map((call) => call.slot));
      if (this.countdownEnd <= now) {
        this.countdownEnd = null;
        this.countdownDone = true;
      }
    }
    if (now !== null) this.lastServerMs = now;

    if (frame.phase === "RUNNING" && !frame.spectating) {
      if (
        !this.hurried &&
        this.lastTimeLeft !== null &&
        frame.timeLeftMs !== null &&
        this.lastTimeLeft > HURRY_UP_AT_MS &&
        frame.timeLeftMs <= HURRY_UP_AT_MS &&
        frame.timeLeftMs > 0
      ) {
        this.hurried = true;
        calls.push("match.hurry_up");
      }
      if (this.checkpoints.rose("own", frame.checkpointIndex ?? -1, 0)) calls.push("match.checkpoint");
      if (frame.qualified && !this.qualified) calls.push("match.qualified");
    } else {
      // Outside a running Round the latch only follows: a fresh Round's reset is no Checkpoint.
      this.checkpoints.rose("own", frame.checkpointIndex ?? -1, 0);
    }
    if (frame.qualified) this.qualified = true;
    this.lastTimeLeft = frame.timeLeftMs;

    if (entered && frame.phase === "ROUND_END" && previous !== null) {
      if (frame.timeLeftMs !== null && frame.timeLeftMs <= 0) calls.push("match.time_over");
      calls.push("match.round_end");
    }
    if (entered && frame.phase === "RESULTS" && previous !== null && frame.results) {
      const { matchOver, won, soleWinner, finalRoundNext } = frame.results;
      if (matchOver && won) calls.push("match.results_win", soleWinner ? "match.you_win" : "match.congratulations");
      else calls.push("match.results");
      if (finalRoundNext && now !== null) this.finalRoundAt = now + FINAL_ROUND_DELAY_MS;
    }
    if (this.finalRoundAt !== null && now !== null && now >= this.finalRoundAt) {
      this.finalRoundAt = null;
      if (frame.phase === "RESULTS") calls.push("match.final_round");
    }
    return calls;
  }
}
