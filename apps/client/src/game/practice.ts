import {
  DEFAULT_CHARACTER_ID,
  DEFAULT_KILL_PLANE_Y,
  ENVIRONMENT_PRESETS,
  FIXED_STEP_EPSILON_MS,
  MAX_STEPS_PER_FRAME,
  RapierSimulation,
  TICK_MS,
  initPhysics,
  interpolateState,
  movementDirection,
  passesThroughGate,
  pointInOrientedBox,
  resolveTrack,
  trackSpawn,
  trackSpawnYaw,
  type KeyBindings,
  type SimInputs,
} from "@dont-fall/shared";
import { loadCharacterModel } from "../render/characterModel.js";
import { gameAudioContext } from "../audio/gameAudio.js";
import { STAGE_SOUND_SLOTS } from "../audio/slots.js";
import { decodedBytes, loadSoundBank } from "../audio/soundBank.js";
import { stageSoundSlots } from "../audio/stageSounds.js";
import { resumeOnFirstGesture } from "../audio/unlock.js";
import { applyAudioVolumes, readAudioVolumes, subscribeAudioVolumes } from "../lib/audioSettings.js";
import { browserStorage } from "../lib/perfFlag.js";
import { assetPlacements } from "../render/assetVisuals.js";
import { springTriggers } from "../render/springSquash.js";
import { FreeLookCamera, PlayerInput } from "../input/input.js";
import { loadBootBindings, resolveEffectiveBindings, writeStoredBindings } from "../lib/bindingsStore.js";
import { createTeardown, type Teardown } from "../lib/utils/teardown.js";
import { fetchAccount } from "../lib/api/auth.js";
import { createStage } from "../render/scene.js";
import { createTrackLoading } from "./trackLoading.js";
import { createPerfSession } from "./perfSession.js";
import { DEFAULT_GRAPHICS_QUALITY, GRAPHICS_QUALITY_SETTINGS, type GraphicsQuality } from "../lib/graphicsQuality.js";
import type { GameHandle } from "./index.js";

/**
 * What a practice session reports to the shell (m8.1 ticket 03) — the whole
 * React surface of free-roam. Raised once at boot (so the hint bar has a
 * Track name immediately) and again on the finish crossing; never for
 * anything else, so the shell can treat every call as "render this".
 */
export interface PracticeSnapshot {
  trackName: string;
  finished: boolean;
  /** The bindings the session currently plays with — re-emitted when the Account record lands. */
  bindings: KeyBindings;
}

export interface PracticeConfig {
  /** Element the canvas mounts into. The session empties it again on `stop`. */
  mount: HTMLElement;
  /** Host serving the API. Defaults to the host serving the page. */
  host?: string;
  /** Track to roam. Required — with no server there is nothing to default to. */
  trackId: string;
  onPracticeState?: (snapshot: PracticeSnapshot) => void;
  /** Show the performance overlay (M13 ticket 01) — the same one a Match shows. */
  perf?: boolean;
  /** The graphics quality level to draw at (ADR 0079). Omitted, `high`. */
  graphicsQuality?: GraphicsQuality;
}

/**
 * Whether crossing state announces the finish toast (m8.1 ticket 02): on
 * the rising edge only. Afterwards the author keeps running in silence;
 * leaving the zone re-arms, so a second crossing announces again.
 */
export const shouldAnnounceFinish = (alreadyAnnounced: boolean, insideNow: boolean): boolean =>
  insideNow && !alreadyAnnounced;

/**
 * Boot a free-roam practice session (m8.1 ticket 01): the Track, its
 * collision and its visuals through the same the API pipe match boot
 * uses, simulated locally — no socket, no Lobby, no Rounds. Resolves once
 * it is running and rendering; rejects on load failure having released
 * whatever it had already acquired, like `startGame`.
 */
export const startPracticeGame = async (config: PracticeConfig): Promise<GameHandle> => {
  const teardown = createTeardown();
  try {
    return await bootPractice(config, teardown);
  } catch (err) {
    teardown.run();
    throw err;
  }
};

const bootPractice = async (config: PracticeConfig, teardown: Teardown): Promise<GameHandle> => {
  const bootStartedAt = performance.now();
  // Sounds decode alongside the rest of the load, never on first play (ADR 0087).
  const audioContext = gameAudioContext();
  if (audioContext) teardown.add(resumeOnFirstGesture(audioContext, window));
  const [, characterModel] = await Promise.all([
    initPhysics(),
    loadCharacterModel(),
    audioContext ? loadSoundBank(audioContext, STAGE_SOUND_SLOTS) : undefined,
  ]);

  const { fetchTrack, loadLibrary, loadVisualTemplates, loadIceTexture, loadMudTexture, loadBounceTexture, fetchStats } =
    createTrackLoading(config.host);
  const { track, name, environment } = await fetchTrack(config.trackId);
  const trackName = name ?? config.trackId;
  const library = await loadLibrary(track);
  const resolved = resolveTrack(library, track);
  // The Track's own sounds join what every Character makes (already decoding above).
  const sounds = audioContext ? await loadSoundBank(audioContext, stageSoundSlots({ ...resolved, environment })) : undefined;

  const stage = createStage({
    mount: config.mount,
    graphics: GRAPHICS_QUALITY_SETTINGS[config.graphicsQuality ?? DEFAULT_GRAPHICS_QUALITY],
    statics: resolved.statics,
    checkpoints: resolved.checkpoints,
    finishZones: resolved.finishZones,
    killPlaneY: DEFAULT_KILL_PLANE_Y,
    // The Revision's own Environment (ADR 0074), the same one a Match draws.
    environment: ENVIRONMENT_PRESETS[environment],
    spinners: resolved.spinners,
    props: resolved.props,
    characterModel,
    assetTemplates: await loadVisualTemplates(track),
    assetPlacements: assetPlacements(track, library),
    springs: springTriggers(resolved.launchPads, resolved.launchPadOwners),
    bounceDecks: resolved.bounceDecks,
    movingSegments: resolved.movingSegments,
    conveyors: resolved.conveyors,
    iceDecks: resolved.iceDecks,
    iceTexture: await loadIceTexture(),
    mudDecks: resolved.mudDecks,
    mudTexture: await loadMudTexture(),
    bounceTexture: await loadBounceTexture(),
    volumes: resolved.volumes,
    sounds,
  });
  teardown.add(() => stage.dispose());
  // Volumes (ADR 0087): this device's, then every change from Settings, live.
  applyAudioVolumes(stage.sound, readAudioVolumes(browserStorage()));
  teardown.add(subscribeAudioVolumes((volumes) => applyAudioVolumes(stage.sound, volumes), browserStorage()));
  // First-sight compiles and uploads happen now, not in the first metres (M13 ticket 06).
  stage.warmUp();
  const perf = config.perf
    ? createPerfSession({
        mount: config.mount,
        mode: "practice",
        bootStartedAt,
        stage: () => stage,
        trackId: () => config.trackId,
        fetchStats,
        audio: () =>
          stage.sound && audioContext ? { ...stage.sound.stats(), decodedBytes: decodedBytes(audioContext) } : null,
      })
    : null;
  if (perf) teardown.add(() => perf.dispose());
  // The bean wears its skin and hat in practice too (M9 ticket 15, ADR 0083) — best effort, a
  // failed fetch leaves the model natural rather than blocking the boot. The
  // stored token authenticates against the page-host API (that's where login
  // happened), so no host threading even when the Track came from elsewhere.
  // Controls (M9): boot bindings immediately — no boot wait — then the
  // Account's own record when it resolves, applied live (and re-emitted, so
  // the hint bar never disagrees with the hands).
  let keyBindings = loadBootBindings();
  const keyboard = new PlayerInput(window, keyBindings);
  const emitState = (finished: boolean): void => {
    config.onPracticeState?.({ trackName, finished, bindings: keyBindings });
  };
  void fetchAccount()
    .then((account) => {
      stage.setLocalSkin(account?.bodySkin ?? null);
      stage.setLocalHat(account?.hat ?? null);
      keyBindings = resolveEffectiveBindings(account);
      keyboard.setBindings(keyBindings);
      // Refresh the offline mirror while we're here.
      if (account?.bindings) writeStoredBindings(account.id, account.bindings);
      emitState(finishAnnounced);
    })
    .catch(() => stage.setLocalSkin(null));
  teardown.add(() => keyboard.dispose());
  const look = new FreeLookCamera(stage.domElement);
  // Start looking along the Start's forward (ADR 0068).
  look.yaw = trackSpawnYaw(track) ?? look.yaw;
  teardown.add(() => look.dispose());

  // Authoritative, like the server runs it — its own settle-checks end
  // knockdowns, Props simulate fully, falls respawn at Checkpoints, all
  // with no snapshot to reconcile against. Deliberately WITHOUT finish
  // zones: the shared step substitutes idle input once `finishTick` is set
  // (M5 ticket 01), which is exactly the match behavior free-roam drops —
  // the author keeps driving after crossing. The crossing itself is still
  // detected, as a pure function of position (ADR 0039), for the toast.
  const sim = new RapierSimulation({
    statics: resolved.statics,
    staticSurfaces: resolved.staticSurfaces,
    staticConveyors: resolved.staticConveyors,
    staticTrimeshes: resolved.staticTrimeshes,
    checkpoints: resolved.checkpoints,
    spinners: resolved.spinners,
    movingSegments: resolved.movingSegments,
    props: resolved.props,
    launchPads: resolved.launchPads,
    volumes: resolved.volumes,
    withDefaultCharacter: false,
    authoritative: true,
  });
  teardown.add(() => sim.dispose());
  sim.addCharacter(DEFAULT_CHARACTER_ID, trackSpawn(track, 0, library));

  emitState(false);

  let accumulatorMs = 0;
  let previousSnapshot = sim.snapshot();
  let finishAnnounced = false;
  let lastPosition = previousSnapshot.characters[DEFAULT_CHARACTER_ID]!.position;
  let lastFrame = performance.now();
  let frameHandle = 0;
  teardown.add(() => cancelAnimationFrame(frameHandle));

  const frame = (now: number): void => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;

    // Same input mapping as match play (M5 ticket 01, ADR 0044/0045) — one
    // mapping to learn, so practice steering is match steering.
    const input: SimInputs = {
      moveDirection: movementDirection(keyboard.movementKeys(), look.yaw),
      jumpHeld: keyboard.jumpHeld(),
      dashHeld: keyboard.dashHeld(),
      hitHeld: keyboard.hitHeld(),
      grabHeld: keyboard.grabHeld(),
      facing: stage.characterFacing(), // ADR 0085: where the body is turned
    };

    // Fixed-timestep local stepping (ADR 0004) — the same accumulator shape
    // and per-frame clamp as `PredictionLoop`, minus everything network:
    // no buffering, no send, no reconcile. Always RUNNING: nothing here
    // ever locks input (M5 ticket 01's gate reads the phase we pass).
    accumulatorMs += elapsedMs;
    let steps = 0;
    const simStartedAt = performance.now();
    while (accumulatorMs + FIXED_STEP_EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      previousSnapshot = sim.snapshot();
      sim.tick({ [DEFAULT_CHARACTER_ID]: input }, "RUNNING");
      accumulatorMs -= TICK_MS;
      steps += 1;
    }
    if (accumulatorMs + FIXED_STEP_EPSILON_MS >= TICK_MS) accumulatorMs = 0;
    const simMs = performance.now() - simStartedAt;

    const snapshot = sim.snapshot();
    const render = interpolateState(previousSnapshot, snapshot, accumulatorMs / TICK_MS);
    const c = snapshot.characters[DEFAULT_CHARACTER_ID]!;
    const visualCharacter = render.characters[DEFAULT_CHARACTER_ID]!;

    // Solo world: Props render straight from the local sim (no server
    // snapshot to pin them to), nobody remote to draw, nothing to spectate.
    stage.applyRenderState({ character: visualCharacter, props: render.props });
    stage.applySpringSquash({ [DEFAULT_CHARACTER_ID]: visualCharacter }, now);
    stage.applyBounceSheets({ [DEFAULT_CHARACTER_ID]: visualCharacter }, now);
    stage.applyCharacterSounds({ [DEFAULT_CHARACTER_ID]: visualCharacter }, DEFAULT_CHARACTER_ID, now);
    // Air columns (ADR 0075) — practice draws the same flow a Match does.
    stage.updateAirColumns(now);
    stage.updateCharacterAnimation(
      // Same backgrounded-tab clamp as match play (`MAX_ANIMATION_DELTA_MS`
      // in `game/index.ts`) — animation delta only, never sim time.
      Math.min(elapsedMs, 100) / 1000,
      input.moveDirection,
      c.grounded,
      c.dashing,
      c.dashSpeed,
      c.velocity.y,
      c.hitEpoch,
      0,
      // G still reaches: every attempt bumps `grabEpoch`, caught or not.
      c.grabEpoch,
      // Solo: a Grab only ever engages another Character (`activeGrabs` is
      // keyed grabber → held), and free-roam has none — so an attempt never
      // becomes a hold, and there is no hold to draw or facing to freeze.
      // Literal rather than read off `c`, which can only ever report null
      // here (ADR 0071).
      undefined,
      false,
    );
    stage.updateMotion(snapshot.tick - 1 + accumulatorMs / TICK_MS);
    stage.updateCamera(visualCharacter.position, look.yaw, look.pitch, Math.min(elapsedMs, 100) / 1000);

    // The finish that reports instead of ending (m8.1 ticket 02) — position
    // in a finish trigger, read off the same resolved zones the stage
    // draws. The sim itself never learns (see above), so this fires without
    // side effects and the author runs on.
    // A finish sign counts the frame you pass under it (ADR 0068), a retired block while you're in it.
    const insideNow = resolved.finishZones.some((zone) =>
      zone.gate ? passesThroughGate(lastPosition, c.position, zone.gate) : pointInOrientedBox(c.position, zone.trigger),
    );
    lastPosition = c.position;
    if (shouldAnnounceFinish(finishAnnounced, insideNow)) {
      finishAnnounced = true;
      emitState(true);
    } else if (!insideNow) {
      finishAnnounced = false;
    }

    const renderStartedAt = performance.now();
    stage.render();
    perf?.frame(now, elapsedMs, simMs, steps, performance.now() - renderStartedAt, visualCharacter.position);

    frameHandle = requestAnimationFrame(frame);
  };

  frameHandle = requestAnimationFrame(frame);

  // The full `GameHandle` shape so the shell needs no second handle type —
  // everything lobby-shaped is a documented no-op: a practice session has
  // no lobby, no host, no rounds to pick and nobody to send to. Spectating
  // joins that list (ticket 14): no Round, no elimination, no other beans —
  // nothing to follow, hold, or enter.
  const notInPractice = (): void => {};
  return {
    stop: () => teardown.run(),
    setNickname: notInPractice,
    setReady: notInPractice,
    selectTrack: notInPractice,
    setRoundType: notInPractice,
    setMatchLength: notInPractice,
    pickRoundSlot: notInPractice,
    start: notInPractice,
    standingsReady: notInPractice,
    spectateFollow: notInPractice,
    spectateNext: notInPractice,
    spectatePrev: notInPractice,
    setFreeCam: notInPractice,
    enterSpectate: notInPractice,
  };
};
