import { COUNTDOWN_MS, TICK_MS, msToTicks } from "../tuning.js";

/**
 * Where a Match currently is (CONTEXT.md, ADR 0040). The server owns every
 * transition from COUNTDOWN on; clients render this and never compute it.
 *
 * `ROUND_END` and `RESULTS` are declared here because they are the machine
 * ADR 0040 defines, and a client switching on `phase` should be exhaustive
 * from the start — but nothing produces them yet. M4 ticket 05 adds the
 * transitions into them.
 */
export type MatchPhase = "LOBBY" | "COUNTDOWN" | "RUNNING" | "ROUND_END" | "RESULTS";

/** The phase plus the Tick it began on — everything the machine needs to advance itself. */
export interface MatchState {
  phase: MatchPhase;
  /**
   * The Tick this phase started. Every duration in the Match is measured from
   * here in Ticks (ADR 0004), which is what lets a client render the same
   * Countdown the server is running rather than one from its own clock.
   */
  phaseStartTick: number;
}

/** What the machine needs to know about the world to decide the next phase. */
export interface MatchPhaseInputs {
  /** The server Tick being decided. */
  tick: number;
  connectedPlayers: number;
  /** How many Players a Round waits for (see `PLAYERS_TO_START`). */
  playersToStart: number;
  /**
   * How long the Countdown holds. Defaults to {@link COUNTDOWN_MS}; a
   * parameter rather than a constant read straight from here so a test can
   * put a server into a running Round without sitting through three real
   * seconds of it.
   */
  countdownMs?: number;
}

/**
 * Whether this phase locks every Character's input.
 *
 * Shared rather than server-only on purpose: the client runs it too, so its
 * own prediction stops driving the Character on exactly the Tick the server
 * stops accepting input for it. Without that the two disagree for half an RTT
 * at both ends of the Countdown — which is precisely the "nothing jumps at
 * zero" the synchronous start exists to deliver.
 */
export const phaseLocksInput = (phase: MatchPhase): boolean => phase !== "RUNNING";

/**
 * The Match phase for `tick`, given the phase it was in (ADR 0040). Pure, and
 * never mutates the state it is handed — the server calls it once per tick
 * and keeps whatever comes back.
 *
 * The transitions M4 ticket 04 owns:
 * - LOBBY → COUNTDOWN once enough Players are connected. Ticket 07's Lobby
 *   replaces the trigger with a host pressing start; the transition itself
 *   does not change.
 * - COUNTDOWN → RUNNING after {@link COUNTDOWN_TICKS}, on one exact Tick, for
 *   everyone at once.
 * - anything → LOBBY once the last Player leaves, so the server is ready for
 *   whoever connects next. A Round with nobody in it is over.
 *
 * A Player dropping *part way* is deliberately not a transition: whoever is
 * left still gets their Round, and recording the DNF is ticket 05's job.
 * RUNNING → ROUND_END is ticket 05's too, which is why RUNNING is terminal
 * here.
 */
export const advanceMatchPhase = (
  state: MatchState,
  { tick, connectedPlayers, playersToStart, countdownMs = COUNTDOWN_MS }: MatchPhaseInputs,
): MatchState => {
  if (connectedPlayers === 0) {
    return state.phase === "LOBBY" ? state : { phase: "LOBBY", phaseStartTick: tick };
  }
  if (state.phase === "LOBBY" && connectedPlayers >= playersToStart) {
    return { phase: "COUNTDOWN", phaseStartTick: tick };
  }
  if (state.phase === "COUNTDOWN" && tick - state.phaseStartTick >= msToTicks(countdownMs)) {
    return { phase: "RUNNING", phaseStartTick: tick };
  }
  return state;
};

/**
 * Milliseconds left on the Countdown at `tick`, or 0 in any other phase —
 * what a client renders its "3, 2, 1" from, so the number on screen is the
 * server's own and not a local estimate.
 */
export const countdownMsLeft = (state: MatchState, tick: number, countdownMs = COUNTDOWN_MS): number => {
  if (state.phase !== "COUNTDOWN") return 0;
  const left = countdownMs - (tick - state.phaseStartTick) * TICK_MS;
  return left < 0 ? 0 : left > countdownMs ? countdownMs : left;
};
