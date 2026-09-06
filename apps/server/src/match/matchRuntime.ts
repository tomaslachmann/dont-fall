import {
  MODULE_LIBRARY,
  RapierSimulation,
  resolveTrack,
  trackSpawn,
  type LobbyPlayer,
  type MatchState,
  type Track,
} from "@dont-fall/shared";
import type { WebSocket } from "ws";
import { InputRouter } from "../net/inputRouter.js";
import type { FetchedTrack } from "../track/trackSource.js";

/** Everything `startServer`'s config resolved to, fixed for the life of the process. */
export interface MatchConfig {
  trackServiceUrl: string;
  trackFetchRetryOptions: { maxWaitMs?: number; retryDelayMs?: number; attemptTimeoutMs?: number };
  countdownMs: number;
  roundEndMs: number;
  playersToStart: number;
  timeLimitMsOverride?: number | undefined;
}

/**
 * One Match's live state, and the operations that reset it.
 *
 * This exists because the state genuinely is shared: the connection handler,
 * the Lobby handlers and the tick loop all read and write the same phase, the
 * same tick counter and the same world, and they now live in three files. The
 * alternative to naming it is threading a dozen mutable variables through
 * every call, which hides the coupling rather than removing it.
 *
 * Fields are mutable on purpose — this is the thing that changes every tick.
 * What is `readonly` is what never gets replaced: the collections and the
 * resolved config.
 */
export class MatchRuntime {
  readonly sockets = new Map<string, WebSocket>();

  /**
   * Every connected Player as the Lobby sees them (M4 ticket 07, ADR 0040) —
   * nickname, Ready, and the join order that decides who the host is
   * (`resolveHostId`, recomputed, never stored). Kept in step with `sockets`
   * one-for-one: populated in the same place a connection registers itself,
   * deleted in the same place `'close'` cleans everything else up.
   */
  readonly lobbyPlayers = new Map<string, LobbyPlayer>();

  readonly inputs = new InputRouter();

  /** The world. Replaced wholesale by a Playtest reload or a Lobby Track pick. */
  simulation: RapierSimulation;
  fetched: FetchedTrack;

  /**
   * The server's own monotonic tick — advances by exactly one every interval,
   * unconditionally, from before any client connects (ADR 0027).
   */
  serverTick = 0;
  /** The Tick this Round's clock counts from — set by the COUNTDOWN → RUNNING transition (ADR 0038). */
  roundStartTick = 0;
  match: MatchState = { phase: "LOBBY", phaseStartTick: 0 };

  /** Players who dropped while the Round was being raced (M4 ticket 05). */
  dnf: { id: string; nickname: string }[] = [];

  /** One-shot edges, set by a Lobby handler and spent by the next tick. */
  startRequested = false;
  returnToLobbyRequested = false;
  /** Guards a `selectTrack` whose fetch is still in flight against a newer pick. */
  selectTrackSeq = 0;

  /** Whether this Round has met either of its endings, as of the last Tick simulated (M4 ticket 05). */
  roundEnding = { allQualified: false, timeExpired: false };
  /** What the Round clock read when the Round ended, so it stops rather than springs back. */
  finalTimeLeftMs = 0;

  /** Monotonic across the process so each joiner gets a distinct spawn slot. */
  joinCount = 0;

  constructor(
    readonly config: MatchConfig,
    fetched: FetchedTrack,
  ) {
    this.fetched = fetched;
    // The Match starts with no players; ticket 01's single-player default
    // Character is opted out here rather than added and immediately disposed.
    this.simulation = this.rebuildSimulationFor(fetched.track);
  }

  /**
   * This Round's Time Limit — the Revision's own (ADR 0038), unless a test has
   * overridden it. A method, not a captured value: a reload replaces `fetched`
   * with a different Track carrying a different clock.
   */
  roundTimeLimitMs(): number {
    return this.config.timeLimitMsOverride ?? this.fetched.timeLimitMs;
  }

  /**
   * Builds a fresh simulation for `track` and re-seats every currently
   * connected Player into it at a spawn for their own join order (M4 ticket
   * 07) — the one thing the original boot-time-only reload (Track Builder's
   * own Playtest `?track=`) never had to do, since it only ever ran with
   * `sockets.size === 0`. A Lobby's host picking a different Track can do this
   * with others already sitting in it; nobody's Character should vanish just
   * because the world under it changed.
   */
  rebuildSimulationFor(track: Track): RapierSimulation {
    const next = new RapierSimulation({
      ...resolveTrack(MODULE_LIBRARY, track),
      withDefaultCharacter: false,
    });
    for (const [playerId, player] of this.lobbyPlayers) {
      next.addCharacter(playerId, trackSpawn(track, player.joinOrder));
    }
    return next;
  }

  /**
   * The one reset every "start a fresh Round on `track`" transition shares —
   * the connect-time `?track=` reload, a live Lobby `selectTrack`, and M4
   * ticket 08's return from Results: swap in a freshly-built simulation and
   * restart the tick/phase bookkeeping it depends on.
   *
   * The replacement is built before the old one is disposed
   * (`rebuildSimulationFor` can throw — an unknown Module id in a Track
   * published against a newer library); disposing first would leave this
   * server holding a freed Rapier world for every subsequent tick.
   *
   * `serverTick` restarts with the new simulation's own tick counter (ADR
   * 0027), or every subsequent input — stamped from the client's *new*
   * `state.tick`, always small — reads as permanently stale against the old,
   * much larger `serverTick`: every queued input discarded before it can ever
   * match `thisTick`, and the resulting `lastInputTick` ack (now way ahead of
   * what the client sent) makes the client think everything it sent already
   * got applied. No one can move, for the rest of this process's life.
   *
   * Callers still own anything specific to their own trigger — which Track
   * `fetched` now points at, clearing `dnf`, resetting Ready.
   *
   * Also clears `startRequested` — a live `selectTrack`'s own `await` leaves a
   * window where a `start` sent right behind it can be validated and queued
   * against the *old* Lobby before this reset lands, then get spent by the
   * tick loop right after, starting a Round on the just-swapped-away Track.
   */
  resetToFreshLobby(track: Track): void {
    const nextSimulation = this.rebuildSimulationFor(track);
    this.simulation.dispose();
    this.simulation = nextSimulation;
    this.serverTick = 0;
    this.roundStartTick = 0;
    this.match = { phase: "LOBBY", phaseStartTick: 0 };
    this.startRequested = false;
  }
}
