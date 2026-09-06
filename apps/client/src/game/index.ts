import {
  DEFAULT_KILL_PLANE_Y,
  INITIAL_LEAD_TICKS_MAX,
  INITIAL_LEAD_TICKS_MIN,
  INPUT_REDUNDANCY,
  LEAD_DRAIN_FRACTION,
  IDLE_INPUTS,
  MODULE_LIBRARY,
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
  movementDirection,
  phaseLocksInput,
  qualificationPlacement,
  resolveTrack,
  type ClientMessage,
  type LobbyPlayer,
  type MatchPhase,
  type PropSnapshot,
  type RenderCharacter,
  type ResultsRow,
  type ServerMessage,
  type SimInputs,
  type SimState,
  type Track,
  type Vec3,
} from "@dont-fall/shared";
import { loadCharacterModel } from "../render/characterModel.js";
import { awaitWelcome, resolveEndpoints } from "../lib/connection.js";
import { createHud } from "../hud/hud.js";
import { formatHudText } from "../hud/hudText.js";
import { FreeLookCamera, KeyboardInput } from "../input/input.js";
import { listen } from "../lib/listeners.js";
import { createStage } from "../render/scene.js";
import { NetMetrics } from "../net/netMetrics.js";
import { PropPredictionController, graceTicksForRtt } from "../net/propPrediction.js";
import { matchBanner } from "../hud/matchBanner.js";
import { PredictionLoop } from "../net/predictionLoop.js";
import { formatRoundClock } from "../lib/roundTimer.js";
import { SnapshotInterpolator } from "../net/snapshotInterpolation.js";
import { createTeardown, type Teardown } from "../lib/teardown.js";
import { TimeSync } from "../net/timeSync.js";

/**
 * Cap on the per-frame delta fed to the Character model's animation/facing
 * update. `advanceFixed` already bounds how many sim ticks a stalled frame
 * can catch up on; this bounds the render-only animation step the same way,
 * so a backgrounded-tab refocus can't snap the facing or jump the clip.
 */
const MAX_ANIMATION_DELTA_MS = 100;

/** Why the game stopped being playable and handed control back to the shell. */
export type ExitReason = "disconnected";

/**
 * The Lobby as this client currently sees it (M4 ticket 07, ADR 0040) — a
 * read of the snapshot's own `lobby`/`trackId`/`trackRevision` fields, plus
 * `myId` so a Lobby Screen can tell "you" apart without threading the
 * `WelcomeMessage` through separately. Rendered, never computed: `hostId`
 * reassigns itself the instant the server sees the original host disconnect.
 *
 * Carries `phase` too, not just while it's LOBBY: a Lobby Screen overlaying
 * `<GameCanvas>` needs to know the instant the Match leaves LOBBY so it can
 * unmount itself, same as the Countdown overlay's own read of `phase`
 * (ADR 0040) — folding it in here means one dedupe against the snapshot
 * rate covers both "the roster changed" and "the phase changed."
 */
export interface LobbySnapshot {
  myId: string;
  phase: MatchPhase;
  hostId: string | undefined;
  players: LobbyPlayer[];
  trackId: string;
  trackRevision: number;
  /**
   * The currently-loaded Track's Time Limit (ADR 0038: "the Lobby only ever
   * reads" it) — this IS `SnapshotMessage.timeLeftMs`, which already holds at
   * the full clock until the Round is RUNNING, so it needs no separate
   * "authored Time Limit" field of its own.
   */
  timeLimitMs: number;
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
  /** Host serving the Match server and track-service. Defaults to the host serving the page. */
  host?: string;
  /** A specific Track to play — Track Builder's Playtest (ADR 0028). Omitted: whatever the server chose. */
  trackId?: string;
  /**
   * Declared because ADR 0008 names it as half of the game's boundary
   * ("config in, `onMatchEnd`/`onExit` out"), but nothing raises it: Results
   * (M4 ticket 08) turned out to be an overlay on this same, still-running
   * `<GameCanvas>` — read `onResults`/`phase` below — rather than a reason to
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
   * Raised on every snapshot whose Results content actually changed (M4
   * ticket 08), while `phase` is RESULTS — a Results Screen renders this the
   * same way a Lobby Screen renders `onLobbyState`: an overlay on top of the
   * already-rendering `<GameCanvas>`, not a route the shell navigates to.
   * Deduped the same way, against the same snapshot-rate firehose.
   */
  onResults?: (results: ResultsRow[]) => void;
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
  /** Host-only: asks the server to start the Round (M4 ticket 07). Ignored unless the server's own gate passes. */
  start: () => void;
  /** Host-only: asks the server to return to the Lobby from Results (M4 ticket 08). Ignored outside RESULTS. */
  returnToLobby: () => void;
}

/**
 * Boot the game. Resolves once it is running and rendering; rejects if it
 * could not start (server unreachable, track-service unreachable, a
 * missing/invalid Revision) — having released whatever it had already
 * acquired, so a failed start leaks nothing either.
 */
export const startGame = async (config: GameConfig): Promise<GameHandle> => {
  const teardown = createTeardown();
  try {
    return await boot(config, teardown);
  } catch (err) {
    teardown.run();
    throw err;
  }
};

const boot = async (
  { mount, host, trackId, onExit, onLobbyState, onResults }: GameConfig,
  teardown: Teardown,
): Promise<GameHandle> => {
  const hud = createHud(mount);
  teardown.add(() => hud.dispose());
  hud.setText("DON'T FALL — M2 · connecting to server…");

  const [, characterModel] = await Promise.all([initPhysics(), loadCharacterModel()]);

  const endpoints = resolveEndpoints(host ?? location.hostname, trackId);
  const socket = new WebSocket(endpoints.matchServerUrl);
  teardown.add(() => socket.close());

  const welcome = await awaitWelcome(socket);

  let serverInterp = new SnapshotInterpolator();
  serverInterp.setSnapshotHz(welcome.config.snapshotHz);

  const fetchTrack = async (trackId: string, trackRevision: number): Promise<Track> => {
    const res = await fetch(`${endpoints.trackServiceUrl}/tracks/${trackId}?revision=${trackRevision}`);
    if (!res.ok) {
      throw new Error(`could not fetch Track ${trackId}@${trackRevision} from track-service: HTTP ${res.status}`);
    }
    const { track: fetched } = (await res.json()) as { track: Track };
    return fetched;
  };

  const track = await fetchTrack(welcome.trackId, welcome.trackRevision);
  const { statics, staticSurfaces, checkpoints, finishZones, spinners, props, speedPads, launchPads, volumes } =
    resolveTrack(MODULE_LIBRARY, track);

  let stage = createStage({
    mount,
    statics,
    checkpoints,
    finishZones,
    killPlaneY: DEFAULT_KILL_PLANE_Y,
    spinners,
    props,
    characterModel,
  });
  // These two close over the `let stage`/`let localSim` below and are
  // registered exactly once — a live Lobby Track pick (M4 ticket 07)
  // reassigns those bindings rather than rebuilding this teardown, so the
  // single registration keeps disposing whatever they currently point at.
  teardown.add(() => stage.dispose());
  const keyboard = new KeyboardInput();
  teardown.add(() => keyboard.dispose());
  let look = new FreeLookCamera(stage.domElement);
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
    checkpoints,
    // Qualification is predicted locally (ADR 0039: a pure function of
    // position), so the input lock lands on the same Tick here as on the
    // server instead of half an RTT past the finish. A wrong prediction is
    // corrected — `reconcileCharacter` takes the server's `finishTick`.
    finishZones,
    spinners,
    props,
    speedPads,
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
  let countdownMsLeft = 0;
  /** Last `LobbySnapshot` handed to `onLobbyState`, as JSON — dedupes against the snapshot rate. */
  let lastLobbyJson: string | null = null;
  /** Last Results rows handed to `onResults`, as JSON — same dedupe, same reason (M4 ticket 08). */
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
   * server's own `rebuildSimulationFor` for a live Lobby Track pick (M4
   * ticket 07). `look` is rebuilt too: it holds a reference to `stage`'s own
   * canvas, which `stage.dispose()` removes from the DOM, so a `look` still
   * bound to the old one would never see another mouse event.
   *
   * The tick-space state below is reset, not carried over: the server
   * restarts this Track's `serverTick` at 0 on the same pick (ADR 0027's own
   * "one Tick, one authority" discipline applied to a fresh Lobby), so every
   * prediction/interpolation structure keyed by tick number would otherwise
   * compare the new low ticks against the old high ones forever.
   */
  const loadTrack = async (trackId: string, trackRevision: number, spawn: Vec3): Promise<void> => {
    const nextTrack = await fetchTrack(trackId, trackRevision);
    const resolved = resolveTrack(MODULE_LIBRARY, nextTrack);

    look.dispose();
    stage.dispose();
    stage = createStage({
      mount,
      statics: resolved.statics,
      checkpoints: resolved.checkpoints,
      finishZones: resolved.finishZones,
      killPlaneY: DEFAULT_KILL_PLANE_Y,
      spinners: resolved.spinners,
      props: resolved.props,
      characterModel,
    });
    look = new FreeLookCamera(stage.domElement);

    localSim.dispose();
    localSim = new RapierSimulation({
      statics: resolved.statics,
      staticSurfaces: resolved.staticSurfaces,
      checkpoints: resolved.checkpoints,
      finishZones: resolved.finishZones,
      spinners: resolved.spinners,
      props: resolved.props,
      speedPads: resolved.speedPads,
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
        phase = message.phase;
        countdownMsLeft = message.countdownMsLeft;
        if (onLobbyState) {
          const lobbySnapshot: LobbySnapshot = {
            myId,
            phase: message.phase,
            hostId: message.lobby.hostId,
            players: message.lobby.players,
            trackId: message.trackId,
            trackRevision: message.trackRevision,
            timeLimitMs: message.timeLeftMs,
          };
          const lobbyJson = JSON.stringify(lobbySnapshot);
          if (lobbyJson !== lastLobbyJson) {
            lastLobbyJson = lobbyJson;
            onLobbyState(lobbySnapshot);
          }
        }
        if (onResults && message.phase === "RESULTS") {
          const results = buildResults(message.state.characters, message.lobby.players, message.dnf);
          const resultsJson = JSON.stringify(results);
          if (resultsJson !== lastResultsJson) {
            lastResultsJson = resultsJson;
            onResults(results);
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
          // the new Track (`trackSpawn`, mirrored by `rebuildSimulationFor`)
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
          const result = predictionLoop.reconcile(character, message.state.tick, message.state.props, propPrediction);
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

    // Input is locked in every phase but RUNNING (ADR 0040), and the client
    // applies the identical rule to its own prediction that the server
    // applies to the authority — so the Character stops and starts being
    // drivable on the same Tick on both sides, rather than this client
    // predicting half an RTT of movement that the server never simulated.
    // The camera is deliberately untouched: it stays live through the
    // Countdown, which is what lets a player look around before the start.
    const sampledInput: SimInputs = phaseLocksInput(phase)
      ? IDLE_INPUTS
      : {
          moveDirection: movementDirection(keyboard.movementKeys(), look.yaw),
          jumpHeld: keyboard.jumpHeld(),
          dashHeld: keyboard.dashHeld(),
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
    // 0005, 0013, 0021).
    predictionLoop.step(sampledInput, elapsedMs + leadStepMs, sendInput);

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
    stage.applyRemoteCharacters(remoteCharacters);
    stage.updateCharacterAnimation(
      Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000,
      input.moveDirection,
      c.grounded,
      c.dashing,
      c.dashSpeed,
    );
    // Spinner phase is a pure function of the tick and the client can compute
    // it at any tick exactly — so render it at the *prediction* tick, matching
    // what the local Character's own collision runs against, not the delayed
    // render tick (ADR 0025). Use the same render tick the Character itself is
    // drawn at: `render` interpolates [previous, snapshot] by `localAlpha`, and
    // `previous` is one tick behind `snapshot` (captured before `localSim.tick`).
    stage.updateSpinners(snapshot.tick - 1 + localAlpha);
    stage.updateCamera(visualCharacter.position, look.yaw, look.pitch);

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
    // no finishTick" is something both sides can already see.
    const eliminated = isEliminated(phase, latestServerSnapshot?.characters[myId]?.finishTick ?? null);
    hud.setBanner(
      matchBanner({
        phase,
        countdownMsLeft,
        connectedPlayers,
        playersToStart: welcome.config.playersToStart,
        eliminated,
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
    start: () => sendLobbyMessage({ type: "start" }),
    returnToLobby: () => sendLobbyMessage({ type: "returnToLobby" }),
  };
};
