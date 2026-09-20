import { INPUT_REDUNDANCY, initPhysics, initialLeadState, type ClientMessage, type ServerMessage } from "@dont-fall/shared";
import { gameAudioContext } from "../audio/gameAudio.js";
import { MatchCalls } from "../audio/matchCalls.js";
import { setMusicPhase } from "../audio/music.js";
import { STAGE_SOUND_SLOTS } from "../audio/slots.js";
import { loadSoundBank } from "../audio/soundBank.js";
import { resumeOnFirstGesture } from "../audio/unlock.js";
import { createHud } from "../hud/hud.js";
import { PlayerInput } from "../input/input.js";
import { fetchAccount } from "../lib/api/auth.js";
import { applyAudioVolumes, readAudioVolumes, subscribeAudioVolumes } from "../lib/audioSettings.js";
import { loadBootBindings, resolveEffectiveBindings, writeStoredBindings } from "../lib/bindingsStore.js";
import { browserStorage } from "../lib/browserStorage.js";
import { DEFAULT_GRAPHICS_QUALITY, GRAPHICS_QUALITY_SETTINGS } from "../lib/graphicsQuality.js";
import { awaitWelcome, resolveEndpoints } from "../lib/socket/connection.js";
import { listen } from "../lib/socket/listeners.js";
import { createTeardown, type Teardown } from "../lib/utils/teardown.js";
import { PredictionLoop } from "../net/predictionLoop.js";
import { PropPredictionController } from "../net/propPrediction.js";
import { SnapshotInterpolator } from "../net/snapshotInterpolation.js";
import { TimeSync } from "../net/timeSync.js";
import { loadCharacterModel } from "../render/characterModel.js";
import { createFrameLoop } from "./frameLoop.js";
import { startPracticeGame } from "./practice.js";
import { bootTrackRef } from "./roundTrack.js";
import { handleServerMessage } from "./serverMessages.js";
import { ChangeGate, reportWorldReady, type GameCallbacks, type GameSession } from "./session.js";
import { SpectatorController } from "./spectator.js";
import { createTrackLoading } from "./trackLoading.js";
import type { GameConfig, GameHandle } from "./types.js";
import { buildWorld, type WorldDeps } from "./world.js";

export type { ExitReason, GameConfig, GameHandle, StandingsRow, StandingsSnapshot } from "./types.js";

/**
 * Starting a Match session, and nothing else.
 *
 * What the boot assembles lives beside it: `world.ts` builds the Stage and the
 * local simulation for a Track, `session.ts` is the state they all share,
 * `serverMessages.ts` is what a snapshot does to it, and `frameLoop.ts` is what
 * a frame draws from it. `types.ts` is the boundary ADR 0008 asks for — this
 * file re-exports it so the shell still has one import.
 */

/**
 * Boot the game. Resolves once it is running and rendering; rejects if it could
 * not start (server unreachable, the API unreachable, a missing/invalid
 * Revision) — having released whatever it had already acquired, so a failed
 * start leaks nothing either.
 */
export const startGame = async (config: GameConfig): Promise<GameHandle> => {
  if (config.practice) {
    if (config.trackId === undefined) {
      throw new Error("practice mode needs a Track (?track=) — with no server there is nothing to default to");
    }
    return startPracticeGame({
      mount: config.mount,
      trackId: config.trackId,
      ...(config.host === undefined ? {} : { host: config.host }),
      ...(config.onPracticeState === undefined ? {} : { onPracticeState: config.onPracticeState }),
      ...(config.graphicsQuality === undefined ? {} : { graphicsQuality: config.graphicsQuality }),
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

const boot = async (config: GameConfig, teardown: Teardown): Promise<GameHandle> => {
  const { mount, host, trackId, serverPort, connection, graphicsQuality = DEFAULT_GRAPHICS_QUALITY } = config;
  const hud = createHud(mount);
  teardown.add(() => hud.dispose());
  // A borrowed socket (ADR 0056) is already open — the wait is the world
  // loading, not the connection. Says so, so a handoff mid-Countdown reads
  // honestly instead of claiming to connect.
  hud.setStatus(connection === undefined ? "connecting to server…" : "loading…");

  // Sounds decode alongside the rest of the load, never on first play (ADR
  // 0087). What every Character makes starts now; the Track's own sounds join
  // once it is known, and files already decoded here are not decoded again.
  const audioContext = gameAudioContext();
  if (audioContext) teardown.add(resumeOnFirstGesture(audioContext, window));
  if (connection === undefined) teardown.add(() => setMusicPhase(null));
  const [, characterModel] = await Promise.all([
    initPhysics(),
    loadCharacterModel(),
    audioContext ? loadSoundBank(audioContext, STAGE_SOUND_SLOTS) : undefined,
  ]);

  // A shell-owned connection arrives with its socket already open and its
  // welcome already consumed — dial only when the game owns the lifetime
  // itself (standalone / `?track=` playtest). A borrowed socket is never
  // closed here; the shell still owns it.
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

  // Volumes (ADR 0087): this device's, then every change from Settings, live.
  // Read from the current Stage when heard, so a live Track swap is followed.
  let audioVolumes = readAudioVolumes(browserStorage());
  // Track-service reads shared with the practice session (m8.1 ticket 01) —
  // one pipe, one cache, no fork to drift.
  const deps: WorldDeps = {
    mount,
    graphics: GRAPHICS_QUALITY_SETTINGS[graphicsQuality],
    characterModel,
    loading: createTrackLoading(host),
    audioContext,
    volumes: () => audioVolumes,
    myId: welcome.playerId,
  };

  // The Track the Match is on *now*, never the one this socket's `welcome`
  // named when it opened (ADR 0056: the Lobby opened it, possibly before the
  // host's pick). Booting on a stale ref draws a world the server is not
  // simulating — see `roundTrack.ts`.
  const ref = bootTrackRef(welcome, connection?.getLobby());
  const built = await buildWorld(deps, ref, welcome.spawn);
  // Registered once, against `session.world` rather than this build: a live
  // Track swap replaces what that points at, and this keeps disposing whatever
  // it currently holds.
  teardown.add(() => {
    session.world.look.dispose();
    session.world.stage.dispose();
    session.world.localSim.dispose();
  });
  teardown.add(
    subscribeAudioVolumes((volumes) => {
      audioVolumes = volumes;
      applyAudioVolumes(session.world.stage.sound, volumes);
    }, browserStorage()),
  );

  // Controls (M9): boot bindings immediately — no boot wait — then the
  // Account's own record when it resolves, applied live.
  const keyboard = new PlayerInput(window, loadBootBindings());
  teardown.add(() => keyboard.dispose());
  void fetchAccount()
    .then((account) => {
      keyboard.setBindings(resolveEffectiveBindings(account));
      // Refresh the offline mirror while we are here.
      if (account?.bindings) writeStoredBindings(account.id, account.bindings);
    })
    .catch(() => {});

  const serverInterp = new SnapshotInterpolator();
  serverInterp.setSnapshotHz(welcome.config.snapshotHz);

  const callbacks: GameCallbacks = {
    ...(config.onExit === undefined ? {} : { onExit: config.onExit }),
    ...(config.onLobbyState === undefined ? {} : { onLobbyState: config.onLobbyState }),
    ...(config.onStandings === undefined ? {} : { onStandings: config.onStandings }),
    ...(config.onRunEnd === undefined ? {} : { onRunEnd: config.onRunEnd }),
    ...(config.onHitTaken === undefined ? {} : { onHitTaken: config.onHitTaken }),
    ...(config.onSpectate === undefined ? {} : { onSpectate: config.onSpectate }),
    ...(config.onRoundHud === undefined ? {} : { onRoundHud: config.onRoundHud }),
    ...(config.onWorldReady === undefined ? {} : { onWorldReady: config.onWorldReady }),
    ...(config.onPause === undefined ? {} : { onPause: config.onPause }),
  };

  const session: GameSession = {
    myId: welcome.playerId,
    welcome,
    socket,
    hud,
    keyboard,
    matchCalls: new MatchCalls(),
    deps,
    callbacks,
    borrowedSocket: connection !== undefined,
    world: {
      ...built,
      predictionLoop: new PredictionLoop(built.localSim, welcome.playerId),
      trackId: ref.trackId,
      trackRevision: ref.trackRevision,
      reloadInFlight: false,
    },
    net: {
      serverInterp,
      propPrediction: new PropPredictionController(),
      // NTP-style clock sync (ADR 0019) — feeds the interpolation buffer's
      // clock and the net-graph RTT.
      timeSync: new TimeSync(),
      latestSnapshot: null,
      heldSinceTick: null,
      lead: initialLeadState(),
      connectionLost: false,
    },
    match: {
      phase: "LOBBY",
      timeLeftMs: null,
      countdownEndsAtServerMs: null,
      survival: false,
      roundElapsedMs: null,
      livePlaces: null,
      resultsCall: null,
      musicPhase: null,
    },
    roster: { names: {}, colors: {}, skins: {}, hats: {}, accounts: {}, known: new Map() },
    run: { wasFinished: false, wasEliminated: false, verdictFired: false, lastHitEpochs: null },
    spectate: {
      // Who this client follows (M7 ticket 07) — its own choice, never sent
      // anywhere. Reset the moment spectating ends, so no stale target
      // survives into the next Round.
      controller: new SpectatorController(),
      requested: false,
      freeCam: false,
      freeCamPose: null,
      followRequest: null,
      steps: 0,
      backs: 0,
    },
    gates: {
      lobby: new ChangeGate(),
      standings: new ChangeGate(),
      roundHud: new ChangeGate(),
      spectate: new ChangeGate(),
    },
  };
  // The world is built; the Round this client is in waits for exactly this (ADR 0089).
  reportWorldReady(session, ref);

  // Attached long after connecting (Track fetch, Stage build), so in an idle
  // phase the join-push is already gone — ask for the current state outright
  // (ADR 0057's `sync`; the next tick pushes).
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "sync" } satisfies ClientMessage));
  teardown.add(
    listen(socket, "message", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as ServerMessage;
      handleServerMessage(session, message, performance.now());
    }),
  );
  teardown.add(listen(socket, "error", (event) => console.error("DON'T FALL: connection error", event)));
  teardown.add(
    listen(socket, "close", () => {
      console.warn("DON'T FALL: disconnected from server");
      session.net.connectionLost = true;
      clearInterval(pingInterval);
      callbacks.onExit?.("disconnected");
    }),
  );

  // Time-sync probes (ADR 0019): a burst on connect to converge the estimate
  // fast, then one a second to track drift and RTT changes.
  const sendPing = (): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(session.net.timeSync.ping(performance.now())));
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
  // ones (ADR 0021) — the input buffer is already pruned to `tick > acked` by
  // `reconcile`, so its tail is exactly the unacknowledged set. A WebSocket
  // head-of-line burst or reorder then loses nothing; the server dedupes by tick.
  const sendInput = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const tail = session.world.predictionLoop.inputBuffer.slice(-(INPUT_REDUNDANCY + 1));
    socket.send(JSON.stringify({ type: "input", inputs: tail } satisfies ClientMessage));
  };

  const loop = createFrameLoop(session, sendInput);
  // Nothing draws once the loop stops, so nothing would place a voice again —
  // and the last frame's scene must not be what the podium is then heard
  // through (ADR 0111). Registered *before* the loop's own stop because
  // teardown is newest-first: the loop stops, then the voices go flat.
  if (config.onVoiceScene) teardown.add(() => config.onVoiceScene?.(null));
  teardown.add(() => loop.stop());
  // Loaded: the status line has nothing more to say until a connection is lost.
  hud.setStatus(null);
  loop.start();

  const send = (message: ClientMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  return {
    stop: () => teardown.run(),
    setReady: (ready) => send({ type: "setReady", ready }),
    selectTrack: (pick) => send({ type: "selectTrack", trackId: pick }),
    setRoundType: (roundType) => send({ type: "setRoundType", roundType }),
    setMatchLength: (matchLength) => send({ type: "setMatchLength", matchLength }),
    pickRoundSlot: (roundIndex, pick, roundType) => send({ type: "pickRoundSlot", roundIndex, trackId: pick, roundType }),
    start: () => send({ type: "start" }),
    standingsReady: () => send({ type: "standingsReady" }),
    spectateFollow: (playerId) => {
      session.spectate.followRequest = playerId;
    },
    spectateNext: () => {
      session.spectate.steps += 1;
    },
    spectatePrev: () => {
      session.spectate.backs += 1;
    },
    setFreeCam: (on) => {
      session.spectate.freeCam = on;
    },
    enterSpectate: () => {
      session.spectate.requested = true;
    },
    resume: () => session.world.look.relock(),
  };
};
