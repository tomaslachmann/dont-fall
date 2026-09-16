import {
  DEFAULT_KILL_PLANE_Y,
  ENVIRONMENT_PRESETS,
  INITIAL_LEAD_TICKS_MAX,
  INITIAL_LEAD_TICKS_MIN,
  INPUT_REDUNDANCY,
  LEAD_DRAIN_FRACTION,
  IDLE_INPUTS,
  RapierSimulation,
  TICK_MS,
  TICK_RATE_HZ,
  addVec3,
  buildResults,
  initPhysics,
  isDownMotionState,
  isEliminated,
  interpolateState,
  lengthVec3,
  matchScore,
  matchWinner,
  movementDirection,
  phaseLocksInput,
  qualificationPlacement,
  rankWithTies,
  resolveTrack,
  type ClientMessage,
  type LobbyPlayer,
  type MatchPhase,
  type MatchWinner,
  type Module,
  type PropSnapshot,
  type RenderCharacter,
  type ResultsRow,
  type RoundType,
  type ServerMessage,
  type SimInputs,
  type SimState,
  type Track,
  type Vec3,
  trackSpawnYaw,
} from "@dont-fall/shared";
import { loadCharacterModel } from "../render/characterModel.js";
import { assetPlacements, loadAssetVisuals } from "../render/assetVisuals.js";
import { springTriggers } from "../render/springSquash.js";
import { awaitWelcome, resolveEndpoints } from "../lib/socket/connection.js";
import { createHud } from "../hud/hud.js";
import { formatHudText } from "../hud/hudText.js";
import { FreeLookCamera, KeyboardInput } from "../input/input.js";
import { listen } from "../lib/socket/listeners.js";
import { startPracticeGame } from "./practice.js";
import type { PracticeSnapshot } from "./practice.js";
import { createTrackLoading } from "./trackLoading.js";
import { createStage } from "../render/scene.js";
import { NetMetrics } from "../net/netMetrics.js";
import { PropPredictionController, graceTicksForRtt } from "../net/propPrediction.js";
import { matchBanner } from "../hud/matchBanner.js";
import {
  isMatchSpectator,
  isSpectating,
  livingIds,
  SpectatorController,
  type SpectateSnapshot,
} from "./spectator.js";
import { detectHitTaken, type HitBaseline, type HitTakenEvent } from "./hitTaken.js";
import { detectRunEnd, type RunEndEvent } from "./runEnd.js";
import { PredictionLoop } from "../net/predictionLoop.js";
import { formatRoundClock } from "../lib/utils/roundTimer.js";
import { SnapshotInterpolator } from "../net/snapshotInterpolation.js";
import { createTeardown, type Teardown } from "../lib/utils/teardown.js";
import { TimeSync } from "../net/timeSync.js";
import { toLobbySnapshot, type LobbyConnection, type LobbySnapshot } from "../lib/socket/lobbyConnection.js";

/**
 * Cap on the per-frame delta fed to the Character model's animation/facing
 * update. `PredictionLoop.step` already bounds how many sim ticks a stalled
 * frame can catch up on (`MAX_STEPS_PER_FRAME`); this bounds the render-only
 * animation step the same way, so a backgrounded-tab refocus can't snap the
 * facing or jump the clip.
 */
const MAX_ANIMATION_DELTA_MS = 100;

/** Why the game stopped being playable and handed control back to the shell. */
export type ExitReason = "disconnected";

/**
 * One Player's running Match total, ready to render (M7 ticket 06, ADR
 * 0049) — computed here from the replicated `roundResults`, never sent:
 * "Score is derived, never sent" (protocol.ts's own `roundResults` doc).
 * `placement` is a tie-aware rank over `score` (`rankWithTies`), never a
 * bare array index — two equal totals share a placement.
 *
 * `gone` is ticket 08's own data contract: true for an id that appears in
 * some `RoundResult`'s rows (so it has Score to show) but is no longer in
 * `lobby.players` (so it isn't here to see it) — a Player who dropped
 * mid-Match, parked rather than erased.
 *
 * `confirmed` (M7 ticket 10/12, ADR 0051) — whether this Player has clicked
 * Ready for the next Round yet, read straight off the replicated
 * `standingsReady` list. Meaningless (always `false`) once the Match has
 * ended — there is no confirmation to gate at that point.
 */
export interface StandingsRow {
  id: string;
  nickname: string;
  score: number;
  placement: number;
  gone: boolean;
  confirmed: boolean;
}

/**
 * Everything a Standings Screen renders for one snapshot (M7 ticket 06) —
 * the Round just played (`results`, identical to what a plain Results
 * Screen showed pre-M7) alongside the Match's running `standings`.
 * `winners` is empty while `roundsRemaining`, and only ever populated
 * (length 1, or more on a genuine tie) once the Match has actually ended.
 */
export interface StandingsSnapshot {
  results: ResultsRow[];
  roundsRemaining: boolean;
  standings: StandingsRow[];
  winners: MatchWinner[];
}

/**
 * Everything the shell tells the game, and everything the game tells the shell
 * back — the "small typed boundary (config in, `onMatchEnd`/`onExit` out)" ADR
 * 0008 requires. Nothing is shared mutable state: the fixed-timestep loop
 * never runs through React, and React never reaches into the loop.
 */
export interface GameConfig {
  /** Element the canvas and HUD are mounted into. The game empties it again on `stop`. */
  mount: HTMLElement;
  /** Host serving the Match server and the API. Defaults to the host serving the page. */
  host?: string;
  /** A specific Track to play — Track Builder's Playtest (ADR 0028). Omitted: whatever the server chose. */
  trackId?: string;
  /**
   * The port of the Lobby the lobby broker sent this Player to (ADR 0054).
   * Every brokered Lobby binds an ephemeral port, so the shell must name
   * one; omitted, this falls back to the fixed-port standalone Match server
   * `scripts/dev.sh` still starts for a single-Lobby test.
   */
  serverPort?: number;
  /**
   * A live shell-owned connection to boot on top of (ADR 0056) — the same
   * socket the Lobby Screen already used, so Player identity (`welcome`)
   * survives the LOBBY → COUNTDOWN handoff instead of rejoining as a
   * stranger on a second socket. When present, `serverPort`/`trackId` are
   * ignored (the socket is already open) and the game never closes it —
   * the shell still owns that lifetime.
   */
  connection?: LobbyConnection;
  /**
   * Free-roam practice instead of a Match (m8.1): the Track simulated
   * locally, no socket, no Lobby, no Rounds. Requires `trackId` — with no
   * server there is nothing to default to.
   */
  practice?: boolean;
  /**
   * Raised once at practice boot (so the hint bar has a Track name
   * immediately) and again on the finish crossing (m8.1 ticket 03) — the
   * whole React surface of a practice session. Never raised in a Match;
   * `onLobbyState`/`onStandings` are never raised in practice.
   */
  onPracticeState?: (snapshot: PracticeSnapshot) => void;
  /**
   * Declared because ADR 0008 names it as half of the game's boundary
   * ("config in, `onMatchEnd`/`onExit` out"), but nothing raises it: Results
   * (M4 ticket 08) turned out to be an overlay on this same, still-running
   * `<GameCanvas>` — read `onStandings`/`phase` below — rather than a reason to
   * leave the Match the way `onExit` does. Reserved for an actual "leave the
   * Match entirely" action, which nothing in the game yet offers.
   */
  onMatchEnd?: () => void;
  /**
   * Raised when the game can no longer continue — today only a lost
   * connection, which M2 does not reconnect from (ADR 0011).
   *
   * The game reports; it never tears itself down. Whether a disconnect routes
   * back to the menu, offers a reload, or is ignored is the shell's decision,
   * and the shell is what calls {@link GameHandle.stop}.
   */
  onExit?: (reason: ExitReason) => void;
  /**
   * Raised on every snapshot whose Lobby content actually changed (M4 ticket
   * 07) — a Lobby Screen renders this as an overlay on top of the already-
   * connected, already-rendering `<GameCanvas>` while `phase === "LOBBY"`,
   * the same way the Countdown overlay reads `phase`/`countdownMsLeft`
   * (ADR 0040). Never fired for a no-op update (nickname/ready/host all
   * unchanged): the snapshot arrives at up to `snapshotHz`, far too often to
   * hand React a fresh object every time regardless of whether anything in
   * it actually moved.
   */
  onLobbyState?: (lobby: LobbySnapshot) => void;
  /**
   * Raised on every snapshot whose Standings content actually changed (M4
   * ticket 08, M7 ticket 06), while `phase` is RESULTS — a Standings Screen
   * renders this the same way a Lobby Screen renders `onLobbyState`: an
   * overlay on top of the already-rendering `<GameCanvas>`, not a route the
   * shell navigates to. Deduped the same way, against the same
   * snapshot-rate firehose.
   */
  onStandings?: (snapshot: StandingsSnapshot) => void;
  /**
   * Raised once per Round when your own run ends mid-Round (ticket 14) — a
   * race finish or a Survival elimination. The FinishedOrOut verdict's
   * facts, off the authoritative snapshot: placement among the field as the
   * server sees it, never the local prediction's guess.
   */
  onRunEnd?: (event: RunEndEvent) => void;
  /**
   * Raised every time your own Character takes a Hit mid-Round (M9 ticket
   * 09, Hit-received) — off your `hitReactEpoch` rising on the authoritative
   * snapshot, never the local prediction. The HitFeedback flash's facts:
   * whether this landing knocked you down with it.
   */
  onHitTaken?: (event: HitTakenEvent) => void;
  /**
   * Raised whenever Spectator Mode's facts change (ticket 14) — who the
   * camera follows, who is still racing, whether FREE CAM holds the pose —
   * and once with `null` when spectating stops. The Spectator panel's feed,
   * deduped against the frame rate like `onLobbyState`.
   */
  onSpectate?: (snapshot: SpectateSnapshot | null) => void;
}

export interface GameHandle {
  /**
   * Tear the game down: the loop, the socket, the Rapier world, the WebGL
   * context, the HUD and every listener. Idempotent, and complete enough that
   * starting again in the same page session leaves nothing behind (M4 ticket 01).
   */
  stop: () => void;
  /** Sets this connection's own nickname (M4 ticket 07). Cosmetic — never a start gate. */
  setNickname: (nickname: string) => void;
  /** Sets this connection's own Ready state (M4 ticket 07). Only meaningful in LOBBY. */
  setReady: (ready: boolean) => void;
  /** Host-only: picks a different Track for this Lobby (M4 ticket 07). Ignored if not host or not in LOBBY. */
  selectTrack: (trackId: string) => void;
  /** Host-only: picks this Lobby's Round type (M5 ticket 07). Ignored if not host or not in LOBBY. */
  setRoundType: (roundType: RoundType) => void;
  /** Host-only: sets this Match's length (M7 ticket 05, ADR 0049). Ignored if not host, not in LOBBY, or out of bounds. */
  setMatchLength: (matchLength: number) => void;
  /**
   * Host-only: picks (or clears) a Track/Round type for a Round after the
   * one about to start (M7 ticket 05) — `roundIndex` is 0-based and counts
   * from Round 1, so `1` is Round 2's slot. `null` for either field leaves
   * it to the server's draw. Ignored if not host, not in LOBBY, or the
   * index doesn't name a Round this Match will actually play.
   */
  pickRoundSlot: (roundIndex: number, trackId: string | null, roundType: RoundType | null) => void;
  /** Host-only: asks the server to start the Round (M4 ticket 07). Ignored unless the server's own gate passes. */
  start: () => void;
  /**
   * Confirms this Player's own Ready for the next Round, from the
   * Standings Screen (M7 ticket 10, ADR 0051) — not host-only, unlike
   * every other action here. Ignored outside RESULTS. Retired
   * `returnToLobby` (M4 ticket 08): there is no group action left to send
   * at Match end, only this Round's own confirmation between Rounds.
   */
  standingsReady: () => void;
  /**
   * Follows one bean exactly (ticket 14) — the Spectator panel's bean
   * buttons. Ignored for anyone not still racing, and outside Spectator
   * Mode entirely: with nobody to follow there is nothing to aim at.
   */
  spectateFollow: (playerId: string) => void;
  /** Steps to the next living bean — the shell NEXT pill's half of the cycle key. */
  spectateNext: () => void;
  /** Steps back — the shell PREV pill's half. */
  spectatePrev: () => void;
  /**
   * Holds (or releases) the camera's pose (ticket 14) — FREE CAM looks
   * around from where the follow was released instead of tracking. Any
   * follow resumes tracking and reports back through `onSpectate`.
   */
  setFreeCam: (on: boolean) => void;
  /**
   * Asks to spectate as a finisher (ticket 14) — the verdict's SPECTATE on
   * a finished run. Elimination spectates unasked; a finisher opts in, and
   * only a finisher: anything else (or anything outside RUNNING) ignores
   * it. Lasts until the Round ends.
   */
  enterSpectate: () => void;
}

/**
 * Boot the game. Resolves once it is running and rendering; rejects if it
 * could not start (server unreachable, the API unreachable, a
 * missing/invalid Revision) — having released whatever it had already
 * acquired, so a failed start leaks nothing either.
 */
export const startGame = async (config: GameConfig): Promise<GameHandle> => {
  if (config.practice) {
    if (config.trackId === undefined) throw new Error("practice mode needs a Track (?track=) — with no server there is nothing to default to");
    return startPracticeGame({
      mount: config.mount,
      trackId: config.trackId,
      ...(config.host === undefined ? {} : { host: config.host }),
      ...(config.onPracticeState === undefined ? {} : { onPracticeState: config.onPracticeState }),
    });
  }
  const teardown = createTeardown();
  try {
    return await boot(config, teardown);
  } catch (err) {
    teardown.run();
    throw err;
  }
};

const boot = async (
  { mount, host, trackId, serverPort, connection, onExit, onLobbyState, onStandings, onRunEnd, onHitTaken, onSpectate }: GameConfig,
  teardown: Teardown,
): Promise<GameHandle> => {
  const hud = createHud(mount);
  teardown.add(() => hud.dispose());
  // Borrowed socket (ADR 0056) is already open — the wait is the world
  // loading, not the connection. Says so, so a handoff mid-Countdown reads
  // honestly instead of claiming to connect.
  hud.setText(connection === undefined ? "DON'T FALL — M2 · connecting to server…" : "DON'T FALL — loading…");

  const [, characterModel] = await Promise.all([initPhysics(), loadCharacterModel()]);

  // A shell-owned connection (ADR 0056) arrives with its socket already open
  // and its welcome already consumed — dial only when the game owns the
  // lifetime itself (standalone/`?track=` playtest, practice excluded above).
  // A borrowed socket is never closed here; the shell still owns it.
  const socket =
    connection?.socket ??
    new WebSocket(
      resolveEndpoints(host ?? location.hostname, {
        ...(trackId === undefined ? {} : { trackId }),
        ...(serverPort === undefined ? {} : { matchServerPort: serverPort }),
      }).matchServerUrl,
    );
  if (connection === undefined) teardown.add(() => socket.close());

  const welcome = connection?.welcome ?? (await awaitWelcome(socket));

  let serverInterp = new SnapshotInterpolator();
  serverInterp.setSnapshotHz(welcome.config.snapshotHz);

  // Track-service reads shared with the practice session (m8.1 ticket 01)
  // — one pipe, one cache, no fork to drift.
  const { fetchTrack, loadLibrary, loadVisualTemplates, loadIceTexture, loadMudTexture, loadBounceTexture } =
    createTrackLoading(host);

  const { track, environment } = await fetchTrack(welcome.trackId, welcome.trackRevision);
  const library = await loadLibrary();
  const {
    statics,
    staticSurfaces,
    staticConveyors,
    staticTrimeshes,
    checkpoints,
    finishZones,
    spinners,
    props,
    launchPads,
    launchPadOwners,
    volumes,
    movingSegments,
    conveyors,
    iceDecks,
    mudDecks,
    bounceDecks,
  } = resolveTrack(library, track);

  let stage = createStage({
    mount,
    statics,
    checkpoints,
    finishZones,
    killPlaneY: DEFAULT_KILL_PLANE_Y,
    // The Revision's own Environment (ADR 0074) — render-only, never sent to the server.
    environment: ENVIRONMENT_PRESETS[environment],
    spinners,
    props,
    characterModel,
    assetTemplates: await loadVisualTemplates(),
    assetPlacements: assetPlacements(track, library),
    springs: springTriggers(launchPads, launchPadOwners),
    movingSegments,
    conveyors,
    iceDecks,
    iceTexture: await loadIceTexture(),
    mudDecks,
    mudTexture: await loadMudTexture(),
    bounceDecks,
    bounceTexture: await loadBounceTexture(),
    volumes,
  });
  // These two close over the `let stage`/`let localSim` below and are
  // registered exactly once — a live Lobby Track pick (M4 ticket 07)
  // reassigns those bindings rather than rebuilding this teardown, so the
  // single registration keeps disposing whatever they currently point at.
  teardown.add(() => stage.dispose());
  const keyboard = new KeyboardInput();
  teardown.add(() => keyboard.dispose());
  let look = new FreeLookCamera(stage.domElement);
  // Start looking along the Start's forward (ADR 0068).
  look.yaw = trackSpawnYaw(track) ?? look.yaw;
  teardown.add(() => look.dispose());

  const myId: string = welcome.playerId;
  // Issued in the welcome (ADR 0024). Stored for a future reclaim on reconnect;
  // M2 does not reconnect.
  const sessionToken: string = welcome.sessionToken;
  void sessionToken; // stored for a future reconnect; unused in M2
  // Set once the socket drops (tab still open, network/server gone). The game
  // loop freezes on the last frame and the HUD says so — there is no reconnect
  // in M2 (ADR 0011), a reload rejoins as a fresh player.
  let connectionLost = false;

  // The local Character is predicted by re-running the exact same shared
  // simulation step the server uses (ticket 03) — its own RapierSimulation,
  // stepped once per fixed sim tick from local input, seeded from the same
  // resolved Track (ticket 11) the stage above was built from.
  let localSim: RapierSimulation = new RapierSimulation({
    statics,
    staticSurfaces,
    staticConveyors,
    staticTrimeshes,
    checkpoints,
    // Qualification is predicted locally (ADR 0039: a pure function of
    // position), so the input lock lands on the same Tick here as on the
    // server instead of half an RTT past the finish. A wrong prediction is
    // corrected — `reconcileCharacter` takes the server's `finishTick`.
    finishZones,
    spinners,
    movingSegments,
    props,
    launchPads,
    volumes,
    withDefaultCharacter: false,
    // Never trust this Character's own settle-check to end a knockdown —
    // only a server snapshot can (ADR 0015). Makes `reconcile`'s
    // down-state sync safe to apply unconditionally.
    authoritative: false,
  });
  teardown.add(() => localSim.dispose());
  // Seed the local prediction at the exact spawn the server used (the
  // per-player spawn grid, ticket 04) — ticket 03's reconcile deliberately
  // never corrects position, so prediction must start already aligned.
  localSim.addCharacter(myId, welcome.spawn);
  // The predict/reconcile core (M4.5 ticket 02, ADR 0013) — accumulator,
  // input buffering, reconciliation and the capsule render-time offset all
  // live here; the frame below keeps only rAF/sockets/rendering/HUD.
  let predictionLoop = new PredictionLoop(localSim, myId);

  // World content this client does not predict — Spinner rotation, Props, other
  // players, this player's own ragdoll while down — comes straight from the
  // server's own broadcast (ADR 0003), smoothed through a render-delay
  // interpolation buffer so it isn't jittered by uneven snapshot arrival.
  // (Constructed in the bootstrap above, before this point.)
  // Pushed-Prop prediction (ADR 0022, ticket 11.8): the one Prop the local
  // Character is contacting is simulated locally for a short grace after last
  // contact and rendered through a decaying error offset; every other Prop is
  // interpolation-only.
  let propPrediction = new PropPredictionController();
  // The raw latest snapshot, kept only for `reconcile` (tick-aligned replay).
  let latestServerSnapshot: SimState | null = null;
  let lastSnapshotArrivedAt = 0;
  /** Latest server-reported Round clock (M4 ticket 03); `null` until the first snapshot. */
  let timeLeftMs: number | null = null;
  /**
   * Latest server-reported Match phase and Countdown (M4 ticket 04, ADR 0040)
   * — rendered, never computed. Starts in LOBBY, which is where a server puts
   * a joiner anyway, so the first frame before any snapshot is honest.
   */
  let phase: MatchPhase = "LOBBY";
  /**
   * Who this client follows in Spectator Mode (M7 ticket 07) — the client's
   * own choice, never sent anywhere. Reset the moment spectating ends, so no
   * stale target survives into the next Round.
   */
  const spectator = new SpectatorController();
  /**
   * Ticket 14's shell surface — everything below is frame-loop or snapshot
   * state for the run-end verdict and the Spectator panel, never sim state:
   * - `roundStartedAtServerMs` anchors both stopwatches (race time,
   *   survived) to the server's own clock, set on RUNNING entry.
   * - `wasFinished`/`wasEliminated` are the previous snapshot's edges;
   *   `runEndFired` keeps the verdict to once per Round.
   * - `lastHitEpochs` is the previous snapshot's Hit baseline (`null` before
   *   the first sighting each Round) — the HitFeedback flash fires off its
   *   edge, unlike the verdict it may fire many times per Round.
   * - `spectateRequested` is a finisher's SPECTATE (the verdict's button) —
   *   elimination spectates unasked, a finisher opts in.
   * - `freeCamOn`/`freeCamPose` hold the camera's pose (FREE CAM); any
   *   follow — bean button, cycle key, shell step — resumes tracking.
   * - `followRequest`/`shellSpectateSteps`/`shellSpectateBacks` are the
   *   handle's one-frame inbox, drained by the loop like the keyboard's.
   */
  let roundStartedAtServerMs = 0;
  let wasFinished = false;
  let wasEliminated = false;
  let runEndFired = false;
  let lastHitEpochs: HitBaseline | null = null;
  let spectateRequested = false;
  let freeCamOn = false;
  let freeCamPose: Vec3 | null = null;
  let followRequest: string | null = null;
  let shellSpectateSteps = 0;
  let shellSpectateBacks = 0;
  let lastSpectateJson: string | null = null;
  let lastRoundIsSurvival = false;
  /** Latest Lobby roster, id → nickname — names the followed Player on the banner. */
  let playerNames: Record<string, string> = {};
  /** Latest Lobby roster, id → equipped body skin (M9 ticket 15) — tints every rig, local one included. */
  let playerSkins: Record<string, number | null> = {};
  /**
   * Every nickname ever seen this session, id → nickname, never cleared
   * (M7 ticket 06/08) — `playerNames` only knows who is connected *right
   * now*, but a Standings row for a Player who dropped mid-Match still
   * needs a name to show, not a bare id.
   */
  const knownNicknames = new Map<string, string>();
  /** Last `LobbySnapshot` handed to `onLobbyState`, as JSON — dedupes against the snapshot rate. */
  let lastLobbyJson: string | null = null;
  /** Last `StandingsSnapshot` handed to `onStandings`, as JSON — same dedupe, same reason (M4 ticket 08). */
  let lastResultsJson: string | null = null;
  const netMetrics = new NetMetrics();
  // NTP-style clock sync (ADR 0019) — feeds the interpolation buffer's clock
  // and the net-graph RTT.
  const timeSync = new TimeSync();
  // Prediction LEAD (ADR 0021): keep the server's command buffer near ~1.5 so it
  // never starves. Pure feedback on the server-reported `commandQueueDepth` — at
  // most one prediction tick injected or dropped per `LEAD_ADJUST_FRAMES`, so it
  // converges over ~1 s with no jerk. Self-limiting (the condition stops firing
  // once the queue is healthy), so a tick lost to the MAX_STEPS clamp just
  // retries on the next window — there is no tracked counter to drift.
  const LEAD_ADJUST_FRAMES = 12;
  let smoothedQueueDepth = 1.5;
  let framesSinceLeadAdjust = LEAD_ADJUST_FRAMES;

  // The Track this client currently has loaded — compared against every
  // snapshot's own `trackId`/`trackRevision` (M4 ticket 07) to notice the
  // Lobby host picking a different one live. Only ever changes in LOBBY
  // (the server rejects `selectTrack` everywhere else), so there is nothing
  // to reconcile input-wise: input is already locked for the whole phase.
  let loadedTrackId = welcome.trackId;
  let loadedTrackRevision = welcome.trackRevision;
  // Set for the async gap between noticing a Track change and finishing the
  // rebuild below — `reconcile` is skipped meanwhile (guarded at the call
  // site) since `localSim` still holds the *old* Track's geometry while the
  // server has already moved the Lobby's Characters onto the new one.
  let trackReloadInFlight = false;

  /**
   * Rebuilds everything derived from the active Track — the mirror of the
   * server's own `buildSimulationFor` for a live Lobby Track pick (M4
   * ticket 07). `look` is rebuilt too: it holds a reference to `stage`'s own
   * canvas, which `stage.dispose()` removes from the DOM, so a `look` still
   * bound to the old one would never see another mouse event.
   *
   * The tick-space state below is replaced rather than carried over, but not
   * because the Tick epoch moves: it does not (M5 ticket 08 — the server
   * hands the rebuilt simulation the Tick it is already on, so a client's
   * once-seeded prediction tick stays valid, which is what keeps everyone
   * already in the Lobby able to move). It is replaced because every one of
   * these structures is keyed by tick *and* describes the old Track: a
   * position history, an interpolation buffer and a replay base recorded
   * against geometry that no longer exists. A fresh `PredictionLoop` re-seeds
   * itself into the same, still-running epoch on the next frame.
   *
   * Note this only runs when the Track actually *changes*. Going again from
   * Results keeps the same Track, so nothing here re-seeds anything — which
   * is exactly why the epoch has to stay continuous rather than being reset
   * and re-seeded around.
   */
  const loadTrack = async (trackId: string, trackRevision: number, spawn: Vec3): Promise<void> => {
    const { track: nextTrack, environment: nextEnvironment } = await fetchTrack(trackId, trackRevision);
    const nextLibrary = await loadLibrary();
    const resolved = resolveTrack(nextLibrary, nextTrack);

    look.dispose();
    stage.dispose();
    stage = createStage({
      mount,
      statics: resolved.statics,
      checkpoints: resolved.checkpoints,
      finishZones: resolved.finishZones,
      killPlaneY: DEFAULT_KILL_PLANE_Y,
      environment: ENVIRONMENT_PRESETS[nextEnvironment],
      spinners: resolved.spinners,
      props: resolved.props,
      characterModel,
      // Templates are session-cached (never refetched here); the disposed
      // stage already freed its own clones with its scene-graph sweep, so
      // the new stage clones afresh from the same templates.
      assetTemplates: await loadVisualTemplates(),
      assetPlacements: assetPlacements(nextTrack, nextLibrary),
      springs: springTriggers(resolved.launchPads, resolved.launchPadOwners),
      movingSegments: resolved.movingSegments,
      conveyors: resolved.conveyors,
      iceDecks: resolved.iceDecks,
      iceTexture: await loadIceTexture(),
      mudDecks: resolved.mudDecks,
      mudTexture: await loadMudTexture(),
      bounceDecks: resolved.bounceDecks,
      bounceTexture: await loadBounceTexture(),
      volumes: resolved.volumes,
    });
    look = new FreeLookCamera(stage.domElement);
    look.yaw = trackSpawnYaw(nextTrack) ?? look.yaw;

    localSim.dispose();
    localSim = new RapierSimulation({
      statics: resolved.statics,
      staticSurfaces: resolved.staticSurfaces,
      staticConveyors: resolved.staticConveyors,
      staticTrimeshes: resolved.staticTrimeshes,
      checkpoints: resolved.checkpoints,
      finishZones: resolved.finishZones,
      spinners: resolved.spinners,
      movingSegments: resolved.movingSegments,
      props: resolved.props,
      launchPads: resolved.launchPads,
      volumes: resolved.volumes,
      withDefaultCharacter: false,
      authoritative: false,
    });
    localSim.addCharacter(myId, spawn);

    serverInterp = new SnapshotInterpolator();
    serverInterp.setSnapshotHz(welcome.config.snapshotHz);
    propPrediction = new PropPredictionController();
    // A fresh instance starts with a clean tick counter, buffer and offset —
    // the exact reset this used to do field-by-field, now just "there is a
    // new one" (M4.5 ticket 02).
    predictionLoop = new PredictionLoop(localSim, myId);

    loadedTrackId = trackId;
    loadedTrackRevision = trackRevision;
  };

  // `awaitWelcome` above already consumed the one-time `welcome` — a Match
  // server sends exactly one per connection (ADR 0024) — so this handler only
  // ever sees `pong`/`snapshot` from here on.
  //
  // Attached long after connecting (Track fetch, stage build), so in an idle
  // phase the join-push is already gone — ask for the current state outright
  // (ADR 0057's `sync`; the next tick pushes). `sendLobbyMessage` is defined
  // below, hence the inline send here.
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "sync" } satisfies ClientMessage));
  teardown.add(
    listen(socket, "message", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as ServerMessage;
      if (message.type === "pong") {
        timeSync.receivePong(message, performance.now());
      } else if (message.type === "snapshot") {
        latestServerSnapshot = message.state;
        lastSnapshotArrivedAt = performance.now();
        serverInterp.receive(message.state, lastSnapshotArrivedAt, message.serverTimeMs);
        // The Round clock is the server's (ADR 0038) — held as it arrived and
        // rendered, never advanced locally between snapshots. At the snapshot
        // rate that is a visible step of at most one tenth of a second on a
        // display that only shows whole seconds.
        timeLeftMs = message.timeLeftMs;
        // Ticket 14: RUNNING entry anchors the run stopwatches to the
        // server's own clock and re-arms the once-per-Round verdict — `phase`
        // below still holds the previous phase here, which is what makes
        // this an entry edge rather than a level.
        if (message.phase === "RUNNING" && phase !== "RUNNING") {
          roundStartedAtServerMs = message.serverTimeMs;
          runEndFired = false;
          wasFinished = false;
          wasEliminated = false;
          lastHitEpochs = null;
        }
        phase = message.phase;
        // The server's own resolved RoundRules (M5 ticket 02, ADR 0041) —
        // adopted every snapshot, same cadence as `phase`, so this client's
        // own prediction runs against the identical record the server does
        // rather than its own construction-time guess at the Track's bare
        // default (which a Match-level override can disagree with).
        localSim.syncRoundRules(message.roundRules);
        playerNames = Object.fromEntries(message.lobby.players.map((player) => [player.id, player.nickname]));
        playerSkins = Object.fromEntries(message.lobby.players.map((player) => [player.id, player.bodySkin]));
        lastRoundIsSurvival = message.roundRules.fallBehavior === "eliminate";
        // Ticket 14: your run ended mid-Round — the verdict's facts, raised
        // once, off this exact snapshot. Outside RUNNING the edges re-sync
        // silently instead, so a late snapshot can't verdict a Round already
        // over, and the next RUNNING entry above re-arms everything anyway.
        if (message.phase === "RUNNING") {
          const myChar = message.state.characters[myId];
          if (onRunEnd && !runEndFired && myChar !== undefined) {
            const elapsed = message.serverTimeMs - roundStartedAtServerMs;
            const event = detectRunEnd({
              wasFinished,
              wasEliminated,
              character: myChar,
              characters: message.state.characters,
              myId,
              raceTimeMs: elapsed,
              survivedMs: elapsed,
            });
            if (event) {
              runEndFired = true;
              onRunEnd(event);
            }
          }
          wasFinished = myChar !== undefined && myChar.finishTick !== null;
          wasEliminated = myChar?.eliminated ?? false;
          // M9 ticket 09 (Hit-received): your own Hit flash, raised off
          // every `hitReactEpoch` edge on these same snapshots — unlike the
          // verdict above, a Round can flash many times. The baseline
          // re-syncs every snapshot (and resets off-Round below), so a
          // reordered snapshot never re-fires what already played.
          if (onHitTaken && myChar !== undefined) {
            const hitEvent = detectHitTaken({ previous: lastHitEpochs, character: myChar });
            if (hitEvent) onHitTaken(hitEvent);
          }
          lastHitEpochs =
            myChar === undefined
              ? lastHitEpochs
              : { hitReactEpoch: myChar.hitReactEpoch, ragdollEpoch: myChar.ragdollEpoch };
        } else {
          wasFinished = false;
          wasEliminated = false;
          runEndFired = false;
          lastHitEpochs = null;
          spectateRequested = false;
        }
        for (const player of message.lobby.players) knownNicknames.set(player.id, player.nickname);
        for (const dropped of message.dnf) knownNicknames.set(dropped.id, dropped.nickname);
        if (onLobbyState) {
          // One projection, shared with the shell's own connection (ADR
          // 0056) — the game never maintains a second mapping of the same
          // snapshot, so the two can never disagree about the Lobby.
          const lobbySnapshot: LobbySnapshot = toLobbySnapshot(myId, welcome.config.maxPlayers, message);
          const lobbyJson = JSON.stringify(lobbySnapshot);
          if (lobbyJson !== lastLobbyJson) {
            lastLobbyJson = lobbyJson;
            onLobbyState(lobbySnapshot);
          }
        }
        if (onStandings && message.phase === "RESULTS") {
          const results = buildResults(message.state.characters, message.lobby.players, message.dnf);
          // M7 ticket 10, ADR 0051: the server's own `canContinueMatch()` —
          // Rounds remain *and* enough Players are still connected to run
          // one — read straight off the snapshot, never re-derived from
          // `roundResults.length < matchLength` alone (code review): that
          // ignores the population half of the gate, and used to show a
          // "Ready for next Round" button the server would never honour
          // once population had already dropped it below its own bar.
          const roundsRemaining = message.roundsRemaining;

          // `matchScore` (packages/shared, ADR 0049) is the only place this
          // arithmetic lives — never re-derived here, only laid out for
          // display. `connectedIds` covers a Player who has joined but not
          // yet raced (score 0, still worth listing); `gone` is ticket 08's
          // contract: scored in some Round, absent from `lobby.players` now.
          const totals = matchScore(message.roundResults);
          const connectedIds = new Set(message.lobby.players.map((player) => player.id));
          const confirmedIds = new Set(message.standingsReady);
          const rowIds = new Set([...Object.keys(totals), ...connectedIds]);
          const unranked = Array.from(rowIds, (id) => ({
            id,
            nickname: knownNicknames.get(id) ?? id,
            score: totals[id] ?? 0,
            gone: !connectedIds.has(id),
            confirmed: confirmedIds.has(id),
          })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
          const placements = rankWithTies(unranked, (prev, curr) => prev.score === curr.score);
          const standings: StandingsRow[] = unranked.map((row, i) => ({ ...row, placement: placements[i]! }));

          const winners = roundsRemaining ? [] : matchWinner(message.roundResults);

          const snapshot: StandingsSnapshot = { results, roundsRemaining, standings, winners };
          const resultsJson = JSON.stringify(snapshot);
          if (resultsJson !== lastResultsJson) {
            lastResultsJson = resultsJson;
            onStandings(snapshot);
          }
        }
        netMetrics.commandQueueDepth = message.commandQueueDepth;
        smoothedQueueDepth += (message.commandQueueDepth - smoothedQueueDepth) * 0.2;

        // The Lobby host picked a different Track (M4 ticket 07) — the server
        // already re-seated every connected Character onto it (this
        // snapshot's `state` reflects that), so `localSim` must follow before
        // anything else here trusts it. Only relevant in LOBBY: the server
        // never lets `trackId`/`trackRevision` change anywhere else.
        if (
          message.phase === "LOBBY" &&
          !trackReloadInFlight &&
          (message.trackId !== loadedTrackId || message.trackRevision !== loadedTrackRevision)
        ) {
          trackReloadInFlight = true;
          // The server already placed this Character at its spawn slot on
          // the new Track (`trackSpawn`, mirrored by `buildSimulationFor`)
          // — read straight off this very snapshot rather than recomputing
          // it, so there is exactly one source for "where do I start."
          const spawn = message.state.characters[myId]?.position ?? welcome.spawn;
          loadTrack(message.trackId, message.trackRevision, spawn)
            .catch((err: unknown) => console.error("DON'T FALL: failed to load the Lobby's newly picked Track", err))
            .finally(() => {
              trackReloadInFlight = false;
            });
        }

        const character = message.state.characters[myId];
        if (character && !trackReloadInFlight) {
          // `reconcile` pins Props to `message.state.props` itself before its
          // replay, so replayed ticks slide against Props where the server has
          // them (ADR 0016 — Props are never predicted). The live prediction's
          // Prop and mirror obstacles are re-pinned every frame from the
          // *interpolated* render pose instead — see the frame loop — so an
          // obstacle sits exactly where it's drawn and advances smoothly
          // between snapshots rather than jumping once per snapshot (which,
          // for a Prop you're pushing, read as a per-snapshot sawtooth / lag).
          const result = predictionLoop.reconcile(
            character,
            message.state.tick,
            message.state.props,
            propPrediction,
            message.phase,
          );
          if (result.positionError !== null) netMetrics.recordCorrection(result.positionError);
        }
      }
    }),
  );
  teardown.add(listen(socket, "error", (event) => console.error("DON'T FALL: connection error", event)));
  teardown.add(
    listen(socket, "close", () => {
      console.warn("DON'T FALL: disconnected from server");
      connectionLost = true;
      clearInterval(pingInterval);
      onExit?.("disconnected");
    }),
  );

  // Time-sync probes (ADR 0019): a burst on connect to converge the estimate
  // fast, then one a second to track drift and RTT changes.
  const sendPing = (): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(timeSync.ping(performance.now())));
  };
  teardown.add(
    listen(socket, "open", () => {
      for (let i = 0; i < 8; i += 1) {
        const handle = setTimeout(sendPing, i * 40);
        teardown.add(() => clearTimeout(handle));
      }
    }),
  );
  const pingInterval = setInterval(sendPing, 1000);
  teardown.add(() => clearInterval(pingInterval));

  // Send the current tick's input plus a redundant tail of the last few unacked
  // ones (ADR 0021) — `predictionLoop.inputBuffer` is already pruned to
  // `tick > acked` by `reconcile`, so its tail is exactly the unacknowledged
  // set. A WebSocket head-of-line burst or reorder then loses nothing; the
  // server dedupes by tick.
  const sendInput = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const tail = predictionLoop.inputBuffer.slice(-(INPUT_REDUNDANCY + 1));
    socket.send(JSON.stringify({ type: "input", inputs: tail } satisfies ClientMessage));
  };

  let lastFrame = performance.now();
  let fps = 0;
  let frameHandle = 0;
  teardown.add(() => cancelAnimationFrame(frameHandle));

  const frame = (now: number) => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;
    fps += (1000 / Math.max(elapsedMs, 1) - fps) * 0.1;

    timeSync.tick(elapsedMs);
    if (timeSync.ready) serverInterp.setServerClockOffsetMs(timeSync.serverClockOffsetMs);

    if (connectionLost) {
      // Freeze on the last frame — no reconnect in M2 (ADR 0011). Render once
      // more so the HUD updates, then let the loop stop. `onExit` has already
      // told the shell; stopping the game is its call, not ours.
      hud.setText("DON'T FALL — connection lost\nreload the page to rejoin");
      stage.render();
      return;
    }

    // Sampled unconditionally — whether it actually drives the Character is
    // the shared step's own call now (M5 ticket 01, ADR 0044): `phase` goes
    // down to `predictionLoop.step` below, and `RapierSimulation.tick` is the
    // one place, on both sides, that decides "may this Character be driven
    // this tick?" — so it stops and starts driving on the identical Tick the
    // server does, rather than this client predicting half an RTT of movement
    // the server never simulated. The camera is deliberately untouched here:
    // it stays live through the Countdown, which is what lets a player look
    // around before the start.
    const sampledInput: SimInputs = {
      moveDirection: movementDirection(keyboard.movementKeys(), look.yaw),
      jumpHeld: keyboard.jumpHeld(),
      dashHeld: keyboard.dashHeld(),
      hitHeld: keyboard.hitHeld(),
      grabHeld: keyboard.grabHeld(),
      // M6, ADR 0045: the plain angle the camera already resolved to, not the
      // camera itself — the simulation stays exactly as camera-agnostic as
      // moveDirection already keeps it (ADR 0009).
      facing: look.yaw,
    };

    // World this client doesn't predict — Props and every other player's
    // Character — comes from the render-delay interpolation buffer (ADR 0003).
    // Computed here, before the predict loop, because the mirror capsules and
    // Prop obstacles are placed from it (below).
    const serverRender = serverInterp.ready ? serverInterp.sample(now) : null;

    // ADR 0027: seed the prediction tick into the server's own tick space,
    // once, as soon as both estimates are available. Ongoing drift afterward
    // is corrected by the existing LEAD feedback below (ADR 0021) — this only
    // needs to land in the right ballpark, not stay exact forever.
    if (!predictionLoop.isSeeded && timeSync.ready && serverInterp.ready) {
      const leadTicks = Math.max(
        INITIAL_LEAD_TICKS_MIN,
        Math.min(INITIAL_LEAD_TICKS_MAX, Math.ceil(timeSync.rttMs / 2 / TICK_MS) + 1),
      );
      predictionLoop.seed(serverInterp.estimatedServerTick(now), leadTicks);
    }

    // Refresh the obstacles this client's prediction slides against — other
    // players' mirror capsules (ADR 0012) and every Prop (ADR 0016) — every
    // frame from the *interpolated* render pose, so an obstacle sits exactly
    // where it's drawn and advances smoothly between snapshots instead of
    // jumping once per snapshot. For a Prop you're pushing, the jump-per-
    // snapshot version read as a sawtooth / lag: predict blocked → snap
    // forward on the next snapshot → predict blocked again.
    if (serverRender) {
      const others: Record<string, Vec3> = {};
      for (const [id, character] of Object.entries(serverRender.characters)) {
        const down = isDownMotionState(character.motionState);
        // A player who is down gets no mirror at all — you run through a
        // floored body rather than snag on a half-buried pelvis-height
        // capsule (the M2 simplification, made explicit).
        if (id !== myId && !down) others[id] = character.position;
      }
      localSim.syncMirrorCharacters(others);
      localSim.syncPropsToSnapshot(serverRender.props);
    }
    // A Prop the local Character is currently predicting (ADR 0022) is left
    // to simulate freely this frame instead of being pinned above; every
    // other Prop stays a pinned obstacle. Membership is decided from last
    // frame's contact + grace (updated below, after the predict loop). With no
    // interpolated world yet (buffer underrun) nothing is predicted — the
    // state machine can't advance without server poses, so it stays frozen.
    localSim.setPredictedProps(serverRender ? propPrediction.predictedIndices : []);

    // LEAD feedback (ADR 0021, gentle drain per ADR 0026): inject at most one
    // prediction tick per window when the queue is starving — responsive,
    // since an empty queue means the server is about to repeat a stale
    // input. Draining a fat queue never jumps a whole tick at once (that
    // yanks the render-interpolation alpha in a single frame — a second,
    // connection-quality-scaled backward pop, distinct from the position
    // correction above) — instead it bleeds off a small fraction of a tick
    // every frame for as long as the queue stays over the band.
    framesSinceLeadAdjust += 1;
    let leadStepMs = 0;
    if (timeSync.ready) {
      if (framesSinceLeadAdjust >= LEAD_ADJUST_FRAMES && smoothedQueueDepth < 1) {
        leadStepMs = TICK_MS;
        framesSinceLeadAdjust = 0;
      } else if (smoothedQueueDepth > 2.5) {
        leadStepMs = -TICK_MS * LEAD_DRAIN_FRACTION;
      }
    }
    // Fixed-timestep prediction: one shared sim step per tick, each fed —
    // and sent to the server, from `onBuffered` — with the input sampled for
    // that tick, and each buffered by tick number for reconciliation (ADR
    // 0005, 0013, 0021). `phase` is what lets the shared step gate it (M5
    // ticket 01) — this call sends real input over the wire even while
    // locked, same as the server always has; only whether it moves the
    // Character is decided, identically, on both sides.
    predictionLoop.step(sampledInput, elapsedMs + leadStepMs, sendInput, phase);

    const snapshot = localSim.snapshot();

    // Advance the pushed-Prop state machine (ADR 0022) for this frame: which
    // Props the local capsule just touched, grace expiry, and one render
    // frame of error-offset decay. Must be after the predict loop so
    // `contacted` and the sim poses are current. Always drain the contact set
    // so it can't accumulate a stale burst while the interpolated world is
    // briefly unavailable — in that window the machine is reset to all-pinned.
    const contactedProps = localSim.consumeContactedProps();
    if (serverRender) {
      propPrediction.frame({
        contacted: contactedProps,
        predictionTick: predictionLoop.tick,
        graceTicks: graceTicksForRtt(timeSync.rttMs),
        dtMs: Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS),
        simProps: snapshot.props,
        serverProps: serverRender.props,
      });
    } else {
      propPrediction.reset();
    }

    const previous = predictionLoop.previousSnapshot ?? snapshot;
    const localAlpha = predictionLoop.accumulatorMs / TICK_MS;
    const render = interpolateState(previous, snapshot, localAlpha);
    const c = snapshot.characters[myId]!;
    const input = sampledInput;

    // While down, draw the local Character exactly like a remote one: from
    // the interpolated server snapshot, not the local prediction (ADR 0015
    // follow-up). `localSim` still runs its own cosmetic ragdoll physics for
    // the ~half-RTT feel before the first confirming snapshot arrives, but
    // once the server *has* confirmed the knockdown, its own down-state
    // pose is jitter-free by construction (the same 30 Hz interpolation
    // that already makes a remote Character's ragdoll look smooth) where
    // the local one drifts from independent, per-machine ragdoll physics
    // that only gets nudged back into rough alignment on every snapshot
    // (`Ragdoll.snapRootTo`) and isn't corrected at all while `GettingUp` —
    // a real reported glitch (an off-centre wall hit settles differently on
    // each side, then pops straight when `Controlled` resumes). There is
    // exactly one down-state position/pose on screen, and it's the server's.
    const localDown = isDownMotionState(c.motionState);
    const serverOwnCharacter = serverRender?.characters[myId];
    const renderCharacter =
      localDown && serverOwnCharacter && serverOwnCharacter.bones.length > 0
        ? serverOwnCharacter
        : render.characters[myId]!;

    // ADR 0026: decay the local Character's own render-time correction
    // offset one frame, same as a pushed Prop's (ADR 0022). Never carried
    // across a motionState change or while down — the offset only smooths
    // corrections against the interpolated Controlled/Stagger pose.
    predictionLoop.decayCapsuleOffset(Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS), c.motionState, localDown);
    // Obstacle/mirror sync and every gameplay read use the raw pose
    // (Fiedler: smoothing must never feed back into the sim or anything
    // that drives further simulation). The camera is not one of those —
    // it is a pure rendering leaf with zero downstream physics
    // consequence — so it follows the same offset-smoothed pose as the
    // drawn mesh (`visualCharacter`, below), not the raw one: a 2026-09
    // playtest found the camera visibly jerking on ordinary corrections
    // (walking, no dash, no Prop involved) because it was still fed the
    // raw stream. Harness-confirmed: the raw stream carries the exact
    // same ~20 cm pop this offset was built to eliminate
    // (`predictionRegression.harness.test.ts`, "the CAMERA target").
    const visualCharacter: RenderCharacter = localDown
      ? renderCharacter
      : { ...renderCharacter, position: addVec3(renderCharacter.position, predictionLoop.capsuleErrorOffset) };
    // Props are drawn from the interpolated server snapshot (ADR 0017),
    // except the one the local Character is pushing, which is drawn from the
    // sub-tick-interpolated local sim pose (`render.props`) plus a decaying
    // error offset (ADR 0022). Nothing is drawn until the first snapshot
    // arrives.
    const props: PropSnapshot[] = serverRender
      ? propPrediction.renderPoses(render.props, serverRender.props)
      : [];
    const remoteCharacters: Record<string, RenderCharacter> = {};
    if (serverRender) {
      for (const [id, character] of Object.entries(serverRender.characters)) {
        if (id !== myId) remoteCharacters[id] = character;
      }
    }

    stage.applyRenderState({ character: visualCharacter, props });
    // Skins ahead of the rigs (M9 ticket 15) — a rig built this frame already
    // wears its skin, and the local model follows the own row's bind.
    stage.setPlayerSkins(new Map(Object.entries(playerSkins)));
    stage.setLocalSkin(playerSkins[myId] ?? null);
    stage.applyRemoteCharacters(remoteCharacters, Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000, myId, visualCharacter.position);
    // The local Character's own Epoch comes from the prediction (ADR 0069):
    // its Spring squashes on the tick it fires, a round trip before the
    // server says so; every other Character's arrives on the snapshot.
    stage.applySpringSquash({ ...remoteCharacters, [myId]: visualCharacter }, now);
    // The same cast for the bounce sheets (ADR 0070): they answer everyone
    // standing on them, not only the Player looking at them.
    stage.applyBounceSheets({ ...remoteCharacters, [myId]: visualCharacter }, now);
    // Air columns (ADR 0075) — the flow every Volume on the Track promises, streamed every frame.
    stage.updateAirColumns(now);
    // Cosmetic only, not a second lock: the sim itself already refused to
    // move the Character while locked (M5 ticket 01), so this just picks the
    // idle stance over animating legs toward a `moveDirection` it never
    // actually walked toward on screen.
    // Code review, M6.1: `c` is `localSim`'s own snapshot, whose Character
    // map only ever holds `myId` itself (every other Player is a lightweight
    // `MirrorCharacter` for collision, never a real second `CharacterController`
    // — see `RapierSimulation.syncMirrorCharacters`), so `c` can never reflect
    // cross-Character authoritative state: Grab and a landed Hit are both
    // only ever resolved against a real second Character, which `localSim`
    // never has. `c.hitEpoch` (this Character's own swing firing) is a pure
    // function of locally-replayed inputs and stays correct read from `c`
    // exactly like `dashCooldownMs`/`dashing` already are — but
    // `hitReactEpoch`/`grabbingId` need the server-derived value instead
    // (`serverOwnCharacter`, already computed above for the local
    // Character's own down-state pose), or the local player would never see
    // their own HitReact land, and never see their own arms reach while
    // grabbing someone.
    const hitReactEpoch = serverOwnCharacter?.hitReactEpoch ?? 0;
    const grabbingId = serverOwnCharacter?.grabbingId ?? null;
    // M6.1: a hold freezes this Character's own rendered yaw, in either role
    // — `grabbingId` (holding someone) or `heldByGrabberId` (being held).
    // Same server-derived reason as `grabbingId` right above: a hold is
    // cross-Character state `localSim` can never resolve on its own. The
    // server freezes the replicated `facing` over the same span, so every
    // other client's rig for this Character stays put too.
    const facingLocked = grabbingId !== null || (serverOwnCharacter?.heldByGrabberId ?? null) !== null;
    // Since ADR 0071 the rig has its own Grab clips and nothing aims any
    // more; this is read only as "this Character is the one doing the
    // holding". It still comes from `remoteCharacters`, since Grab only ever
    // engages another, non-local Character.
    const grabTargetPosition = grabbingId ? remoteCharacters[grabbingId]?.position : undefined;
    stage.updateCharacterAnimation(
      Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000,
      phaseLocksInput(phase) ? IDLE_INPUTS.moveDirection : input.moveDirection,
      c.grounded,
      c.dashing,
      c.dashSpeed,
      c.velocity.y,
      c.hitEpoch,
      hitReactEpoch,
      // Predicted, like `hitEpoch`: the reach starts on the press, and a
      // catch confirmed a round trip later carries on from it.
      c.grabEpoch,
      grabTargetPosition,
      facingLocked,
    );
    // Spinner phase is a pure function of the tick and the client can compute
    // it at any tick exactly — so render it at the *prediction* tick, matching
    // what the local Character's own collision runs against, not the delayed
    // render tick (ADR 0025). Use the same render tick the Character itself is
    // drawn at: `render` interpolates [previous, snapshot] by `localAlpha`, and
    // `previous` is one tick behind `snapshot` (captured before `localSim.tick`).
    stage.updateMotion(snapshot.tick - 1 + localAlpha);
    // Spectator Mode (M7 ticket 07, CONTEXT.md): while eliminated and the
    // Round is still RUNNING, the camera follows a Character still in it —
    // the same collision-resolved spring arm, aimed at somebody else, not a
    // second camera. The followed pose comes from the interpolated render
    // world (`serverRender`, ADR 0025), never a raw snapshot position; who
    // counts as living comes from the authoritative snapshot's own
    // `eliminated` flags. Nobody living (all out on the same Tick, a solo
    // Round) falls back to your own body — always a valid, live target,
    // never a frozen or null camera. Input needs no change: an eliminated
    // Character is never stepped (ADR 0042/0044), so spectating can't drive.
    const ownEliminated = latestServerSnapshot?.characters[myId]?.eliminated ?? c.eliminated;
    // A mid-Match joiner has no Character in the Round at all (M7 ticket
    // 08) — no elimination, just nothing of their own to aim at — so they
    // follow the field through the same path, until a fresh Match seats
    // them and the snapshots start carrying them again.
    const serverHasMe = latestServerSnapshot?.characters[myId] !== undefined;
    const mySnap = latestServerSnapshot?.characters[myId];
    const ownFinished = mySnap !== undefined && mySnap.finishTick !== null;
    // Ticket 14: a finisher may ask to spectate (the verdict's SPECTATE) —
    // the camera-only half of Spectator Mode, which M7 gated on elimination
    // alone. A finished Character isn't stepped either, so this drives
    // nothing, exactly like elimination-spectating.
    const spectating =
      isSpectating(phase, ownEliminated) ||
      isMatchSpectator(phase, serverHasMe) ||
      (phase === "RUNNING" && spectateRequested && ownFinished);
    // Drained every frame either way, so a `C` typed while playing can't
    // bank a stale cycle for the next time you're out.
    const spectatePresses = keyboard.consumeSpectateNext();
    let cameraTarget: Vec3 = visualCharacter.position;
    let spectatingNickname: string | undefined;
    if (spectating && serverRender && latestServerSnapshot) {
      const snap = latestServerSnapshot;
      const living = livingIds(snap.characters, myId);
      spectator.update(living);
      // The shell's inbox, drained like the keyboard's — a bean button names
      // its target, the pills step. Any follow resumes tracking (FREE CAM
      // lasts until someone is followed, however they were picked).
      if (followRequest !== null) {
        spectator.follow(living, followRequest);
        followRequest = null;
        freeCamOn = false;
      }
      for (let i = 0; i < spectatePresses; i += 1) {
        spectator.cycle(living);
        freeCamOn = false;
      }
      for (let i = 0; i < shellSpectateSteps; i += 1) {
        spectator.cycle(living);
        freeCamOn = false;
      }
      shellSpectateSteps = 0;
      for (let i = 0; i < shellSpectateBacks; i += 1) {
        spectator.cyclePrev(living);
        freeCamOn = false;
      }
      shellSpectateBacks = 0;
      const targetId = spectator.target;
      const followed = targetId === null ? undefined : serverRender.characters[targetId];
      if (targetId !== null && followed) {
        cameraTarget = followed.position;
        spectatingNickname = playerNames[targetId];
      }
      // FREE CAM holds the pose the follow was released from — the shell
      // keeps looking around from there instead of tracking.
      if (!freeCamOn) freeCamPose = null;
      else if (freeCamPose === null) freeCamPose = cameraTarget;
      if (freeCamPose !== null) cameraTarget = freeCamPose;
      if (onSpectate) {
        // Everyone still racing but yourself — the out and the finished sit
        // out alike, in cycle order, named off the roster.
        const runners = living
          .filter((id) => snap.characters[id]?.finishTick === null)
          .map((id) => ({ id, nickname: playerNames[id] ?? knownNicknames.get(id) ?? "Player" }));
        const targetCp = targetId === null ? null : (snap.characters[targetId]?.checkpointIndex ?? null);
        const snapshot: SpectateSnapshot = {
          followingId: targetId,
          followingNickname:
            targetId === null ? "—" : (playerNames[targetId] ?? knownNicknames.get(targetId) ?? "Player"),
          // Race rank by progress (higher checkpoint = further ahead);
          // survival has no mid-Round places, only beans left.
          followedPlace:
            lastRoundIsSurvival || targetCp === null
              ? null
              : 1 +
                Object.entries(snap.characters).filter(
                  ([id, c]) => id !== myId && (c.checkpointIndex ?? -1) > targetCp,
                ).length,
          runners,
          beansLeft: runners.length,
          freeCam: freeCamPose !== null,
        };
        const spectateJson = JSON.stringify(snapshot);
        if (spectateJson !== lastSpectateJson) {
          lastSpectateJson = spectateJson;
          onSpectate(snapshot);
        }
      }
    } else {
      spectator.reset();
      freeCamPose = null;
      if (onSpectate && lastSpectateJson !== "null") {
        lastSpectateJson = "null";
        onSpectate(null);
      }
    }
    stage.updateCamera(cameraTarget, look.yaw, look.pitch);

    // The Qualification banner (M4 ticket 02). Shown the instant the local
    // prediction says we're in the zone — that's the same Tick the input lock
    // is felt, so the two never disagree on screen. The *placement* can only
    // come from the server, which is the only side that knows when anyone
    // else crossed, so it fills in a moment later; until then the banner
    // stands without a number rather than guessing "#1".
    const roundClock = timeLeftMs === null ? "--:--" : formatRoundClock(timeLeftMs);
    // Read off the authoritative snapshot, not the local prediction: this
    // client only predicts its own Character, so it is the only side that
    // knows how everyone else is doing (M4 ticket 05).
    const serverCharacters = latestServerSnapshot ? Object.values(latestServerSnapshot.characters) : [];
    const connectedPlayers = serverCharacters.length || 1;
    const qualifiedCount = serverCharacters.filter((character) => character.finishTick !== null).length;
    // Elimination is derived, never replicated — "the Round ended and I have
    // no finishTick" is something both sides can already see. A mid-Match
    // spectator (M7 ticket 08) has no finishTick because they never played,
    // not because they were eliminated — the banner must not say otherwise.
    const eliminated =
      serverHasMe && isEliminated(phase, latestServerSnapshot?.characters[myId]?.finishTick ?? null);
    hud.setBanner(
      matchBanner({
        phase,
        connectedPlayers,
        playersToStart: welcome.config.playersToStart,
        eliminated,
        ...(spectatingNickname === undefined ? {} : { spectatingNickname }),
      }),
    );
    const qualified = c.finishTick !== null;
    const placement = latestServerSnapshot ? qualificationPlacement(latestServerSnapshot.characters, myId) : null;
    netMetrics.rttMs = timeSync.rttMs;
    netMetrics.clockOffsetMs = timeSync.serverClockOffsetMs;
    netMetrics.snapshotAgeMs = now - lastSnapshotArrivedAt;
    netMetrics.ackAgeTicks =
      predictionLoop.tick - (latestServerSnapshot?.characters[myId]?.lastInputTick ?? predictionLoop.tick);
    netMetrics.predictedTick = predictionLoop.tick;
    netMetrics.estServerTick = serverInterp.ready ? serverInterp.estimatedServerTick(now) : 0;
    netMetrics.lead = smoothedQueueDepth; // effective lead = the server's buffered command count
    netMetrics.inputBufferDepth = predictionLoop.inputBuffer.length;
    netMetrics.interpBufferDepth = serverInterp.bufferDepth;
    netMetrics.extrapolating = serverInterp.holdingLatest;
    netMetrics.predictedPropCount = propPrediction.predictedCount;
    netMetrics.capsuleOffsetM = lengthVec3(predictionLoop.capsuleErrorOffset);

    hud.setText(
      formatHudText({
        roundClock,
        phase,
        tickRateHz: TICK_RATE_HZ,
        fps,
        predictionTick: predictionLoop.tick,
        position: c.position,
        motionState: c.motionState,
        checkpointIndex: c.checkpointIndex,
        fallCount: c.fallCount,
        qualifiedCount,
        connectedPlayers,
        qualified,
        placement,
        dashCooldownMs: c.dashCooldownMs,
        hitCooldownMs: c.hitCooldownMs,
        hitChargeMs: c.hitChargeMs,
        netMetricsText: netMetrics.format(),
      }),
    );

    stage.render();
    hud.setLockPromptVisible(!look.locked);

    frameHandle = requestAnimationFrame(frame);
  };

  frameHandle = requestAnimationFrame(frame);

  const sendLobbyMessage = (message: ClientMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  return {
    stop: () => teardown.run(),
    setNickname: (nickname) => sendLobbyMessage({ type: "setNickname", nickname }),
    setReady: (ready) => sendLobbyMessage({ type: "setReady", ready }),
    selectTrack: (trackId) => sendLobbyMessage({ type: "selectTrack", trackId }),
    setRoundType: (roundType) => sendLobbyMessage({ type: "setRoundType", roundType }),
    setMatchLength: (matchLength) => sendLobbyMessage({ type: "setMatchLength", matchLength }),
    pickRoundSlot: (roundIndex, trackId, roundType) => sendLobbyMessage({ type: "pickRoundSlot", roundIndex, trackId, roundType }),
    start: () => sendLobbyMessage({ type: "start" }),
    standingsReady: () => sendLobbyMessage({ type: "standingsReady" }),
    spectateFollow: (playerId) => {
      followRequest = playerId;
    },
    spectateNext: () => {
      shellSpectateSteps += 1;
    },
    spectatePrev: () => {
      shellSpectateBacks += 1;
    },
    setFreeCam: (on) => {
      freeCamOn = on;
    },
    enterSpectate: () => {
      spectateRequested = true;
    },
  };
};
