import {
  DEFAULT_ROUND_TYPE,
  MODULE_LIBRARY,
  RapierSimulation,
  resolveRoundRules,
  resolveTrack,
  roundStartBlockedReason,
  roundTypeOverrides,
  trackSpawn,
  type LobbyPlayer,
  type MatchState,
  type RoundRules,
  type RoundType,
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
  /**
   * Force this Match's `RoundRules.survivorTarget` over whatever Track it
   * loads (M5 ticket 05) — the same kind of Match-level override
   * `timeLimitMsOverride` is, over the same kind of Track default.
   *
   * There is deliberately no `fallBehaviorOverride` beside it any more
   * (ticket 07): that one was never a Track default to override, it was the
   * Round type standing in for a Lobby that couldn't pick one yet. The Lobby
   * picks now ({@link MatchRuntime.setRoundType}), so the stand-in is gone
   * rather than left as a second way to decide the same thing.
   */
  survivorTargetOverride?: number | undefined;
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
   * This Round's rules (M5 ticket 02, ADR 0041/0043) — the Track's own
   * defaults under this Match's overrides, resolved once by
   * {@link buildSimulationFor} every time `simulation`/`fetched` are, and
   * fixed in between. Replicated on the snapshot beside `phase`
   * (`matchLoop.ts`) so the client predicts against the identical record.
   */
  roundRules: RoundRules;
  /**
   * The Round type this Lobby will start (M5 ticket 07) — a name, and the
   * only place in the server one exists. Everything downstream reads
   * {@link roundRules}, which {@link setRoundType} re-resolves from this;
   * nothing branches on the name itself (ADR 0043).
   *
   * Survives a Track pick and the return from Results: a host who chose
   * Survival chose it for this Lobby, not for one Round.
   */
  roundType: RoundType = DEFAULT_ROUND_TYPE;
  /**
   * Whether the currently-loaded Track has a Finish Zone at all (M5 ticket
   * 07) — resolved with the simulation, since `resolveTrack` already
   * answers it, rather than re-flattening the Track every time the Lobby
   * asks. This is the *only* thing that decides whether a Race can run
   * here; no Track is ever tagged with the Round types it allows (ADR 0041).
   */
  trackHasFinishZone: boolean;

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
    const built = this.buildSimulationFor(fetched.track);
    this.simulation = built.simulation;
    this.roundRules = built.roundRules;
    this.trackHasFinishZone = built.trackHasFinishZone;
  }

  /**
   * This Round's rules, from the three sources ADR 0041 allows and no
   * others: the Track Revision's own authored defaults, under the Lobby's
   * Round-type pick, under this Match's own configured overrides.
   *
   * Ordering is the ADR's own — a Round's override beats a Track's default —
   * and the Round type sits between the two because it *is* a Round-level
   * choice, just one a host makes instead of a process config.
   */
  private resolveRules(): RoundRules {
    return resolveRoundRules(
      { timeLimitMs: this.fetched.timeLimitMs, fallBehavior: "respawn", survivorTarget: this.fetched.survivorTarget },
      {
        ...roundTypeOverrides(this.roundType),
        // Spread conditionally, not assigned as a possibly-`undefined` value:
        // an explicit `undefined` here would clobber a field the Round type
        // had just set, the day a Round type overrides more than
        // `fallBehavior`. Same idiom `startServer` uses building this config.
        ...(this.config.timeLimitMsOverride !== undefined ? { timeLimitMs: this.config.timeLimitMsOverride } : {}),
        ...(this.config.survivorTargetOverride !== undefined ? { survivorTarget: this.config.survivorTargetOverride } : {}),
      },
    );
  }

  /**
   * The host picked a Round type (M5 ticket 07). Re-resolves this Round's
   * rules and hands them straight to the live simulation — no rebuild: a
   * Round type changes what the rules *say*, never what the world *is*,
   * unlike a Track pick, which changes both.
   */
  setRoundType(roundType: RoundType): void {
    this.roundType = roundType;
    this.roundRules = this.resolveRules();
    this.simulation.syncRoundRules(this.roundRules);
  }

  /**
   * Why this Lobby can't start right now, in words a Player can read, or
   * `undefined` when it can (M5 ticket 07). One expression, read by both the
   * `start` gate that refuses and the snapshot field that explains — so what
   * a Player is told and what the server enforces can never disagree.
   */
  startBlockedReason(): string | undefined {
    return roundStartBlockedReason(this.roundType, this.trackHasFinishZone);
  }

  /**
   * Builds a fresh simulation for `track` and re-seats every currently
   * connected Player into it at a spawn for their own join order (M4 ticket
   * 07) — the one thing the original boot-time-only reload (Track Builder's
   * own Playtest `?track=`) never had to do, since it only ever ran with
   * `sockets.size === 0`. A Lobby's host picking a different Track can do this
   * with others already sitting in it; nobody's Character should vanish just
   * because the world under it changed.
   *
   * Also resolves `roundRules` (M5 ticket 02, ADR 0041/0043) — `this.fetched`
   * is always updated by the caller before this runs (`selectTrack`, the
   * connect-time reload, going again), so its Time Limit is the fresh Track's
   * own. `timeLimitMsOverride` is this Match's own Round-level override,
   * folded through the same mechanism as everything else rather than staying
   * a special case (ticket 02's own requirement) — the only override this
   * ticket has a source for; a real per-Round choice (a future Lobby control)
   * is more overrides added to the same call, not a new mechanism.
   *
   * `fallBehavior`'s own "Track default" is always the constant `"respawn"`
   * (M5 ticket 03, ADR 0041) — no Track carries a Round-type opinion, so
   * every Round is a Race until the Lobby's own pick says otherwise
   * (`roundType`, ticket 07). `survivorTarget`, by contrast, is a real Track
   * default the Revision authors (ticket 07) — see {@link resolveRules}.
   *
   * Returns both rather than assigning `this.roundRules` as a side effect:
   * `new RapierSimulation` can throw (an unknown Module id), and only the
   * caller (`resetToFreshLobby`) knows it is safe to commit either field —
   * the same "build before discarding the old one" discipline it already
   * follows for `simulation` itself.
   */
  buildSimulationFor(track: Track): { simulation: RapierSimulation; roundRules: RoundRules; trackHasFinishZone: boolean } {
    const roundRules = this.resolveRules();
    const resolved = resolveTrack(MODULE_LIBRARY, track);
    const simulation = new RapierSimulation({
      ...resolved,
      withDefaultCharacter: false,
      roundRules,
    });
    // Onto the Tick the server is already on, before anyone is seated in it
    // (M5 ticket 08) — a Character added at tick 0 and only then jumped
    // forward would carry a `phaseStartTick` thousands of Ticks in its own
    // past. No-op at construction, where `serverTick` is 0.
    simulation.syncTick(this.serverTick);
    for (const [playerId, player] of this.lobbyPlayers) {
      simulation.addCharacter(playerId, trackSpawn(track, player.joinOrder));
    }
    return { simulation, roundRules, trackHasFinishZone: resolved.finishZones.length > 0 };
  }

  /**
   * The one reset every "start a fresh Round on `track`" transition shares —
   * the connect-time `?track=` reload, a live Lobby `selectTrack`, and M4
   * ticket 08's return from Results: swap in a freshly-built simulation and
   * restart the tick/phase bookkeeping it depends on.
   *
   * The replacement is built before the old one is disposed
   * (`buildSimulationFor` can throw — an unknown Module id in a Track
   * published against a newer library); disposing first would leave this
   * server holding a freed Rapier world for every subsequent tick.
   *
   * The Match's Tick epoch is *not* restarted (M5 ticket 08, found live).
   * `state.tick` and `serverTick` must keep agreeing (ADR 0027 addresses
   * every input by Tick number), and the way to keep them agreeing across a
   * rebuild is to hand the new simulation the Tick the server is already on
   * — `syncTick` — not to send both back to zero.
   *
   * Sending both to zero looks equivalent and is not, because a *connected*
   * client's own prediction tick is seeded into the server's Tick space
   * exactly once, at join (ADR 0027, `PredictionLoop.seed`), and never
   * re-seeded. Restarting the epoch under it left every client already in
   * the Lobby stamping inputs from an epoch the server no longer used: the
   * server's `takeFor(id, thisTick)` never found them, `lastInputTick` ran
   * away ahead of what the client had sent, and nobody who was already
   * connected could move again for the rest of the Match. Live, that meant
   * the host picking a different Track — or anyone going again from Results
   * — froze everyone who was already there, on a Track they could see and
   * not walk on.
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
    const built = this.buildSimulationFor(track);
    this.simulation.dispose();
    this.simulation = built.simulation;
    this.roundRules = built.roundRules;
    this.trackHasFinishZone = built.trackHasFinishZone;
    this.roundStartTick = this.serverTick;
    this.match = { phase: "LOBBY", phaseStartTick: this.serverTick };
    this.startRequested = false;
  }
}
