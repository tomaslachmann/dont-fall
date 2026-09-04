import { COUNTDOWN_MS, ROUND_END_MS, TICK_MS, msToTicks } from "../tuning.js";

/**
 * Where a Match currently is (CONTEXT.md, ADR 0040). The server owns every
 * transition from COUNTDOWN on; clients render this and never compute it.
 *
 * The full machine ADR 0040 defines. Every phase is produced: M4 ticket 04
 * added LOBBY/COUNTDOWN/RUNNING, ticket 05 the two that end a Round.
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
  /**
   * Whether every connected Character has Qualified (M4 ticket 05) — see
   * `allQualified`. Ends the Round early.
   */
  allQualified?: boolean;
  /** Whether the Round's Time Limit has run out (M4 ticket 05, ADR 0038). Ends the Round. */
  timeExpired?: boolean;
  /** How long ROUND_END holds before RESULTS. Defaults to {@link ROUND_END_MS}; a parameter for the same reason `countdownMs` is. */
  roundEndMs?: number;
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
 * And the two M4 ticket 05 adds:
 * - RUNNING → ROUND_END the moment every connected Character has Qualified,
 *   or the Round's clock runs out — whichever comes first.
 * - ROUND_END → RESULTS after a short beat.
 *
 * A Player dropping *part way* is still deliberately not a transition:
 * whoever is left still gets their Round, and the DNF is recorded by the
 * server rather than changing the phase. RESULTS is terminal — returning to
 * the Lobby for another Round is M4 ticket 08.
 */
export const advanceMatchPhase = (
  state: MatchState,
  {
    tick,
    connectedPlayers,
    playersToStart,
    countdownMs = COUNTDOWN_MS,
    allQualified = false,
    timeExpired = false,
    roundEndMs = ROUND_END_MS,
  }: MatchPhaseInputs,
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
  if (state.phase === "RUNNING" && (allQualified || timeExpired)) {
    return { phase: "ROUND_END", phaseStartTick: tick };
  }
  if (state.phase === "ROUND_END" && tick - state.phaseStartTick >= msToTicks(roundEndMs)) {
    return { phase: "RESULTS", phaseStartTick: tick };
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
