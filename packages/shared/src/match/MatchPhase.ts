import { TICK_MS, msToTicks } from "../tuning/clock.js";
import { COUNTDOWN_MS, ROUND_END_MS, STANDINGS_READY_TIMEOUT_MS } from "../tuning/match.js";

/**
 * Where a Match currently is (CONTEXT.md, ADR 0040). The server owns every
 * transition from COUNTDOWN on; clients render this and never compute it.
 *
 * The full machine ADR 0040 defines. Every phase is produced: M4 ticket 04
 * added LOBBY/COUNTDOWN/RUNNING, ticket 05 the two that end a Round.
 */
export type MatchPhase = "LOBBY" | "LOADING" | "COUNTDOWN" | "RUNNING" | "ROUND_END" | "RESULTS";

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
  /**
   * Whether the host's `start` has just been validated and handed in — enough
   * Players connected, everyone Ready (M4 ticket 07, ADR 0040). Validated
   * once, by the caller, at the point the message arrived; this pure function
   * only ever asks "has it fired," never re-derives the gate itself. The
   * caller is responsible for clearing it back to `false` once this returns
   * COUNTDOWN, the same way it clears `dnf` on a fresh one.
   */
  startRequested?: boolean;
  /**
   * How long the Countdown holds. Defaults to {@link COUNTDOWN_MS}; a
   * parameter rather than a constant read straight from here so a test can
   * put a server into a running Round without sitting through three real
   * seconds of it.
   */
  countdownMs?: number;
  /**
   * Whether every connected client has reported its world for this Round's
   * Track built (ADR 0089) — a level, recomputed by the caller every Tick
   * from whoever is connected now, like `standingsConfirmed`. Nothing starts
   * without it: a Countdown nobody can see through is a Round they start
   * already behind. There is deliberately no timeout beside it — a Round
   * waits for the people in it.
   */
  everyoneLoaded?: boolean;
  /**
   * Whether every connected Character has Qualified (M4 ticket 05) — see
   * `allQualified`. Ends the Round early.
   */
  allQualified?: boolean;
  /** Whether the Round's Time Limit has run out (M4 ticket 05, ADR 0038). Ends the Round. */
  timeExpired?: boolean;
  /** How long ROUND_END holds before RESULTS. Defaults to {@link ROUND_END_MS}; a parameter for the same reason `countdownMs` is. */
  roundEndMs?: number;
  /**
   * Whether this Match has more Rounds scheduled after the one that just
   * ended (M7 ticket 04, ADR 0049) — `roundResults.length < matchLength`,
   * a level re-read every Tick like `allQualified`, not a one-shot edge.
   * Defaults `false` so a caller that never passes it keeps today's
   * single-Round behaviour: RESULTS stays terminal.
   */
  roundsRemaining?: boolean;
  /**
   * Whether the next Round's world is built and waiting (M7 ticket 04) —
   * set once whatever loading the next Round needs has resolved (nothing
   * yet; ticket 05's Track pick-or-shuffle is the first real user).
   * Meaningless unless {@link roundsRemaining} is `true`.
   */
  nextRoundReady?: boolean;
  /**
   * Whether every currently connected Player has confirmed Ready on the
   * Standings Screen (M7 ticket 10, ADR 0051) — a level, recomputed by the
   * caller every Tick from whoever is still connected (never a snapshot of
   * who was connected when RESULTS began), the same discipline
   * `roundsRemaining`/`nextRoundReady` already follow. Superseded ADR
   * 0049's "advances on its own... not a button" line — confirmed live
   * that a bare `nextRoundReady` alone left the between-Round Standings
   * visible for about one Tick, indistinguishable from no Screen at all.
   */
  standingsConfirmed?: boolean;
  /**
   * Ceiling on how long RESULTS waits for {@link standingsConfirmed} once
   * {@link nextRoundReady} is already true, before advancing anyway — an
   * AFK-Player safety net, not the expected path. Defaults to
   * {@link STANDINGS_READY_TIMEOUT_MS}; a parameter for the same reason
   * `countdownMs`/`roundEndMs` are.
   */
  standingsReadyTimeoutMs?: number;
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
 * Whether the physics world needs to step this tick at all (grilling
 * session, 2026-09) — `COUNTDOWN` and `RUNNING` only. Characters are already
 * spawned and visible with live cameras from `COUNTDOWN` (ADR 0040), so
 * gravity/Spinners/Bump keep running through it exactly like `RUNNING`; a
 * Match sitting in `LOBBY`, `ROUND_END`, or `RESULTS` has `phaseLocksInput`
 * true for every Character already (nothing is moving on its own input
 * regardless), so pausing `world.step()` there changes nothing a Player
 * could have driven — it only stops ambient physics (gravity settling,
 * shoves, Spinners) nobody asked for while no Round is live.
 *
 * `false` here freezes the WHOLE simulation tick, not just the world's step
 * (amended 2026-09-18, found live): when only the step was paused, every
 * Character's own `beginTick` still integrated gravity into a velocity the
 * skipped step never applied, silently winding up −22 u/s per Lobby second —
 * and the Countdown's first sweep, fed metres of accumulated fall in one
 * tick, could put the capsule inside the start deck instead of on it.
 *
 * Shared, not server-only, for the same reason `phaseLocksInput` is: the
 * client predicts through this same `RapierSimulation.tick()` call, so its
 * own local prediction stops burning CPU stepping physics for a Character
 * sitting in a Lobby/Standings Screen nobody can even see move.
 *
 * `RapierSimulation.tick()` still increments its own tick counter every
 * call regardless of this — never gating that is what keeps `state.tick`
 * wall-clock-synced with the server's real-time loop and the client's own
 * prediction tick numbering (ADR 0027); freezing the counter itself instead
 * of just the physics step is exactly the class of bug M5 ticket 08 found
 * live (a paused/reset tick epoch stranding every already-connected client's
 * prediction on a Tick the server would never produce again).
 */
export const phaseNeedsPhysicsStep = (phase: MatchPhase): boolean => phase === "COUNTDOWN" || phase === "RUNNING";

/**
 * The Match phase for `tick`, given the phase it was in (ADR 0040). Pure, and
 * never mutates the state it is handed — the server calls it once per tick
 * and keeps whatever comes back.
 *
 * The transitions M4 ticket 04 owns, as ADR 0089 re-routed the two that
 * start a Round through LOADING:
 * - LOBBY → LOADING once the host's `start` has been validated and handed
 *   in (M4 ticket 07) — replacing ticket 04's own original trigger ("enough
 *   Players connected"), which is now `startRequested`'s job to have already
 *   checked before this ever sees it.
 * - LOADING → COUNTDOWN once every connected client has its world for this
 *   Round's Track built and has said so (ADR 0089).
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
 * server rather than changing the phase.
 *
 * And the one M7 ticket 04/10 adds (ADR 0049, ADR 0051):
 * - RESULTS → LOADING once more Rounds remain in this Match, the next
 *   one's world is ready, and every connected Player has confirmed Ready on
 *   the Standings Screen — or the confirmation timeout has passed, whichever
 *   comes first. A Match's later Rounds never pass through the Lobby, and
 *   every one of them loads its own Track before its Countdown (ADR 0089).
 *
 * RESULTS at Match end (no Rounds remaining) is terminal — there is no
 * transition out of it here at all. Each Player leaves independently, for
 * the Main Menu, which the connection handler sees as an ordinary
 * disconnect; the last one leaving is what the `connectedPlayers === 0`
 * branch above already resets to a fresh LOBBY (M4 ticket 08's own
 * `returnToLobby`/host-gated "go again" is retired, not repurposed).
 */
export const advanceMatchPhase = (
  state: MatchState,
  {
    tick,
    connectedPlayers,
    startRequested = false,
    everyoneLoaded = false,
    countdownMs = COUNTDOWN_MS,
    allQualified = false,
    timeExpired = false,
    roundEndMs = ROUND_END_MS,
    roundsRemaining = false,
    nextRoundReady = false,
    standingsConfirmed = false,
    standingsReadyTimeoutMs = STANDINGS_READY_TIMEOUT_MS,
  }: MatchPhaseInputs,
): MatchState => {
  if (connectedPlayers === 0) {
    return state.phase === "LOBBY" ? state : { phase: "LOBBY", phaseStartTick: tick };
  }
  if (state.phase === "LOBBY" && startRequested) {
    return { phase: "LOADING", phaseStartTick: tick };
  }
  if (state.phase === "LOADING" && everyoneLoaded) {
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
  if (
    state.phase === "RESULTS" &&
    roundsRemaining &&
    nextRoundReady &&
    (standingsConfirmed || tick - state.phaseStartTick >= msToTicks(standingsReadyTimeoutMs))
  ) {
    return { phase: "LOADING", phaseStartTick: tick };
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

/**
 * The Motion Clock (ADR 0123) at `state`: the Tick the Round runs from, which
 * every Ramp counts from. Known from the Countdown's first Tick, because the
 * Countdown ends on exactly `phaseStartTick` plus its length; RUNNING's own
 * start, and the same Round's through ROUND_END. `null` in every phase
 * without a Round in it.
 */
export const motionClockFor = (state: MatchState, roundStartTick: number, countdownMs = COUNTDOWN_MS): number | null => {
  if (state.phase === "COUNTDOWN") return state.phaseStartTick + msToTicks(countdownMs);
  if (state.phase === "RUNNING") return state.phaseStartTick;
  if (state.phase === "ROUND_END") return roundStartTick;
  return null;
};
