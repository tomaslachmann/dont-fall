import type { ClientMessage, MatchPhase, SimState, Vec3, WelcomeMessage } from "@dont-fall/shared";
import { PredictionLoop } from "../net/predictionLoop.js";
import { PropPredictionController } from "../net/propPrediction.js";
import { SnapshotInterpolator } from "../net/snapshotInterpolation.js";
import type { MatchCalls, MatchResultsFrame } from "../audio/matchCalls.js";
import type { Hud } from "../hud/hud.js";
import type { PlayerInput } from "../input/input.js";
import type { TimeSync } from "../net/timeSync.js";
import type { HitBaseline } from "./hitTaken.js";
import type { LobbySnapshot } from "../lib/socket/lobbyConnection.js";
import type { RoundHudSnapshot } from "./roundHud.js";
import type { SpectateSnapshot, SpectatorController } from "./spectator.js";
import type { GameConfig, StandingsSnapshot } from "./types.js";
import { buildWorld, type BuiltWorld, type TrackRef, type WorldDeps } from "./world.js";

/**
 * Everything a running Match session holds, grouped by what it is about.
 *
 * `boot` used to keep all of this as three dozen `let` bindings closed over by
 * the message handler, the frame loop and the handle at once — which made
 * every one of them reachable from everywhere, and none of them nameable. The
 * grouping is the point: a frame reads `session.net` and `session.world`, a
 * snapshot writes `session.match` and `session.roster`, and what each part is
 * allowed to touch is visible at the call site.
 *
 * Fields are mutable on purpose. This is the thing that changes every frame.
 */

/** The world for the Track currently loaded. Replaced wholesale by a live Track swap. */
export interface WorldState extends BuiltWorld {
  /**
   * The predict/reconcile core (M4.5 ticket 02, ADR 0013) — accumulator, input
   * buffering, reconciliation and the capsule render-time offset. The frame
   * loop keeps only rAF, sockets, rendering and the HUD.
   */
  predictionLoop: PredictionLoop;
  /** Which Revision this is, compared against every snapshot's own (M4 ticket 07). */
  trackId: string;
  trackRevision: number;
  /**
   * Set for the async gap between noticing a Track change and finishing the
   * rebuild: reconcile is skipped meanwhile, since `localSim` still holds the
   * *old* Track's geometry while the server has already moved everyone onto
   * the new one.
   */
  reloadInFlight: boolean;
}

/** What arrives over the wire, and the clock and feedback that shape it. */
export interface NetState {
  serverInterp: SnapshotInterpolator;
  /**
   * Pushed-Prop prediction (ADR 0022): the one Prop the local Character is
   * contacting is simulated locally for a short grace after last contact and
   * rendered through a decaying error offset; every other Prop is
   * interpolation-only.
   */
  propPrediction: PropPredictionController;
  /** NTP-style clock sync (ADR 0019) — feeds the interpolation buffer and the RTT. */
  readonly timeSync: TimeSync;
  /** The raw latest snapshot, kept for `reconcile` (tick-aligned replay) and every authoritative read. */
  latestSnapshot: SimState | null;
  /** Prediction LEAD feedback (ADR 0021) — see `LEAD_ADJUST_FRAMES` in the frame loop. */
  smoothedQueueDepth: number;
  framesSinceLeadAdjust: number;
  /**
   * Set once the socket drops (tab still open, network/server gone). The loop
   * freezes on the last frame and the HUD says so — there is no reconnect in
   * M2 (ADR 0011), a reload rejoins as a fresh Player.
   */
  connectionLost: boolean;
}

/** The Match as the server last reported it — rendered, never computed (M4 ticket 04, ADR 0040). */
export interface MatchView {
  /** Starts in LOBBY, which is where a server puts a joiner anyway, so the first frame before any snapshot is honest. */
  phase: MatchPhase;
  /** The server's Round clock (ADR 0038), held as it arrived and never advanced locally between snapshots. */
  timeLeftMs: number | null;
  countdownEndsAtServerMs: number | null;
  /** Anchors both run stopwatches (race time, survived) to the server's clock; set on RUNNING entry. */
  roundStartedAtServerMs: number;
  /** Whether this Round eliminates on a Fall — what the Spectator panel shows places for (ADR 0042). */
  survival: boolean;
  resultsCall: MatchResultsFrame | null;
  /** The phase this game last handed the music, when it owns its own socket (M14 ticket 11). */
  musicPhase: MatchPhase | null;
}

/** Who else is here, off the Lobby roster on every snapshot. */
export interface RosterState {
  /** id → nickname — names the followed Player on the banner. */
  names: Record<string, string>;
  /** id → equipped body color (M9 ticket 15) — tints every rig without a skin. */
  colors: Record<string, number | null>;
  /** Equipped skins by session id (ADR 0091) — a skin paints over the color. */
  skins: Record<string, string | null>;
  /** Equipped hats by session id (ADR 0083). */
  hats: Record<string, string | null>;
  /**
   * Every nickname ever seen this session, never cleared (M7 ticket 06/08) —
   * `names` only knows who is connected *right now*, but a Standings row for
   * a Player who dropped mid-Match still needs a name, not a bare id.
   */
  readonly known: Map<string, string>;
}

/**
 * The previous snapshot's edges for your own run (ticket 14). `verdictFired`
 * keeps the run-end verdict to once per Round; `lastHitEpochs` is the Hit
 * baseline (`null` before the first sighting each Round), off whose edge the
 * HitFeedback flash fires as often as it likes.
 */
export interface RunState {
  wasFinished: boolean;
  wasEliminated: boolean;
  verdictFired: boolean;
  lastHitEpochs: HitBaseline | null;
}

/**
 * Spectator Mode's own state (M7 ticket 07, ticket 14) — the client's choice,
 * never sent anywhere. `followRequest`/`steps`/`backs` are the handle's
 * one-frame inbox, drained by the loop like the keyboard's.
 */
export interface SpectateState {
  readonly controller: SpectatorController;
  /** A finisher's opt-in (the verdict's SPECTATE). Elimination spectates unasked. */
  requested: boolean;
  /** FREE CAM: holds the pose the follow was released from. Any follow resumes tracking. */
  freeCam: boolean;
  freeCamPose: Vec3 | null;
  followRequest: string | null;
  steps: number;
  backs: number;
}

/**
 * Raises a callback only when what it would carry actually changed.
 *
 * Every shell-facing feed needs this: a snapshot arrives at up to
 * `snapshotHz` and a frame at the display's rate, which is far too often to
 * hand React a fresh object regardless of whether anything in it moved (ADR
 * 0040/0088). There were four hand-written copies of this comparison before.
 */
export class ChangeGate<T> {
  private last: string | null = null;

  raise(value: T, fire: (value: T) => void): void {
    const json = JSON.stringify(value);
    if (json === this.last) return;
    this.last = json;
    fire(value);
  }
}

/** The shell-facing callbacks a session raises — {@link GameConfig}'s own half of ADR 0008's boundary. */
export type GameCallbacks = Pick<
  GameConfig,
  "onExit" | "onLobbyState" | "onStandings" | "onRunEnd" | "onHitTaken" | "onSpectate" | "onRoundHud" | "onWorldReady"
>;

export interface GameSession {
  readonly myId: string;
  readonly welcome: WelcomeMessage;
  readonly socket: WebSocket;
  readonly hud: Hud;
  readonly keyboard: PlayerInput;
  /**
   * The Match's voice and jingles (M14 ticket 10): for the whole game, not a
   * Stage, so a Track reload replays nothing.
   */
  readonly matchCalls: MatchCalls;
  /** What building a world needs, unchanged across Track swaps. */
  readonly deps: WorldDeps;
  readonly callbacks: GameCallbacks;
  /** Whether the shell owns this socket (ADR 0056) — a borrowed one is never closed here, and its music is the shell's. */
  readonly borrowedSocket: boolean;

  world: WorldState;
  readonly net: NetState;
  readonly match: MatchView;
  readonly roster: RosterState;
  readonly run: RunState;
  readonly spectate: SpectateState;
  /** One gate per shell-facing feed. */
  readonly gates: {
    lobby: ChangeGate<LobbySnapshot>;
    standings: ChangeGate<StandingsSnapshot>;
    roundHud: ChangeGate<RoundHudSnapshot | null>;
    spectate: ChangeGate<SpectateSnapshot | null>;
  };
}

/**
 * Tell the server this client's world for `ref` is built (ADR 0089) — the last
 * thing between a start and a Countdown. Named per Track: a report for the
 * Track a previous Round ran on is refused by the server rather than counted.
 */
export const sendLoaded = (session: GameSession, ref: TrackRef): void => {
  if (session.socket.readyState !== WebSocket.OPEN) return;
  session.socket.send(
    JSON.stringify({ type: "loaded", trackId: ref.trackId, trackRevision: ref.trackRevision } satisfies ClientMessage),
  );
};

/** The same report, plus the shell, so its loading Screen can step aside. */
export const reportWorldReady = (session: GameSession, ref: TrackRef): void => {
  sendLoaded(session, ref);
  session.callbacks.onWorldReady?.(true);
};

/**
 * Rebuilds everything derived from the active Track — this client's mirror of
 * the server's own `buildSimulationFor` for a live Track pick (M4 ticket 07)
 * or the Track a later Round drew (M7 ticket 04).
 *
 * The tick-space state is replaced rather than carried over, and not because
 * the Tick epoch moves: it does not (M5 ticket 08 — the server hands the
 * rebuilt simulation the Tick it is already on, which is what keeps everyone
 * already in the Lobby able to move). It is replaced because every one of
 * these structures is keyed by tick *and* describes the old Track: a position
 * history, an interpolation buffer and a replay base recorded against geometry
 * that no longer exists. A fresh `PredictionLoop` re-seeds itself into the
 * same, still-running epoch on the next frame.
 *
 * The new world is built before the old one is disposed, so the frame loop has
 * a live Stage to draw throughout the swap. (It kept drawing through it
 * before too — into a Stage that had already been disposed.)
 */
export const swapTrack = async (session: GameSession, ref: TrackRef, spawn: Vec3): Promise<void> => {
  const previous = session.world;
  const built = await buildWorld(session.deps, ref, spawn);
  previous.look.dispose();
  previous.stage.dispose();
  previous.localSim.dispose();
  session.world = {
    ...built,
    predictionLoop: new PredictionLoop(built.localSim, session.myId),
    trackId: ref.trackId,
    trackRevision: ref.trackRevision,
    // Carried, not cleared: the caller that set it owns clearing it.
    reloadInFlight: previous.reloadInFlight,
  };
  session.net.serverInterp = new SnapshotInterpolator();
  session.net.serverInterp.setSnapshotHz(session.welcome.config.snapshotHz);
  session.net.propPrediction = new PropPredictionController();
  // This Track, now built — the Round it belongs to waits for exactly this (ADR 0089).
  reportWorldReady(session, ref);
};
