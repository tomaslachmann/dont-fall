import {
  DEFAULT_CHARACTER_ID,
  DEFAULT_KILL_PLANE_Y,
  FIXED_STEP_EPSILON_MS,
  MAX_STEPS_PER_FRAME,
  RapierSimulation,
  TICK_MS,
  initPhysics,
  interpolateState,
  movementDirection,
  pointInOrientedBox,
  resolveTrack,
  trackSpawn,
  type SimInputs,
} from "@dont-fall/shared";
import { loadCharacterModel } from "../render/characterModel.js";
import { assetPlacements } from "../render/assetVisuals.js";
import { FreeLookCamera, KeyboardInput } from "../input/input.js";
import { createTeardown, type Teardown } from "../lib/teardown.js";
import { createStage } from "../render/scene.js";
import { createTrackLoading } from "./trackLoading.js";
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
}

export interface PracticeConfig {
  /** Element the canvas mounts into. The session empties it again on `stop`. */
  mount: HTMLElement;
  /** Host serving track-service. Defaults to the host serving the page. */
  host?: string;
  /** Track to roam. Required — with no server there is nothing to default to. */
  trackId: string;
  onPracticeState?: (snapshot: PracticeSnapshot) => void;
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
 * collision and its visuals through the same track-service pipe match boot
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
  const [, characterModel] = await Promise.all([initPhysics(), loadCharacterModel()]);

  const { fetchTrack, loadLibrary, loadVisualTemplates } = createTrackLoading(config.host);
  const { track, name } = await fetchTrack(config.trackId);
  const trackName = name ?? config.trackId;
  const library = await loadLibrary();
  const resolved = resolveTrack(library, track);

  const stage = createStage({
    mount: config.mount,
    statics: resolved.statics,
    checkpoints: resolved.checkpoints,
    finishZones: resolved.finishZones,
    killPlaneY: DEFAULT_KILL_PLANE_Y,
    spinners: resolved.spinners,
    props: resolved.props,
    characterModel,
    assetTemplates: await loadVisualTemplates(),
    assetPlacements: assetPlacements(track, library),
  });
  teardown.add(() => stage.dispose());
  const keyboard = new KeyboardInput();
  teardown.add(() => keyboard.dispose());
  const look = new FreeLookCamera(stage.domElement);
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
    staticTrimeshes: resolved.staticTrimeshes,
    checkpoints: resolved.checkpoints,
    spinners: resolved.spinners,
    props: resolved.props,
    speedPads: resolved.speedPads,
    launchPads: resolved.launchPads,
    volumes: resolved.volumes,
    withDefaultCharacter: false,
    authoritative: true,
  });
  teardown.add(() => sim.dispose());
  sim.addCharacter(DEFAULT_CHARACTER_ID, trackSpawn(track, 0));

  config.onPracticeState?.({ trackName, finished: false });

  let accumulatorMs = 0;
  let previousSnapshot = sim.snapshot();
  let finishAnnounced = false;
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
      facing: look.yaw,
    };

    // Fixed-timestep local stepping (ADR 0004) — the same accumulator shape
    // and per-frame clamp as `PredictionLoop`, minus everything network:
    // no buffering, no send, no reconcile. Always RUNNING: nothing here
    // ever locks input (M5 ticket 01's gate reads the phase we pass).
    accumulatorMs += elapsedMs;
    let steps = 0;
    while (accumulatorMs + FIXED_STEP_EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      previousSnapshot = sim.snapshot();
      sim.tick({ [DEFAULT_CHARACTER_ID]: input }, "RUNNING");
      accumulatorMs -= TICK_MS;
      steps += 1;
    }
    if (accumulatorMs + FIXED_STEP_EPSILON_MS >= TICK_MS) accumulatorMs = 0;

    const snapshot = sim.snapshot();
    const render = interpolateState(previousSnapshot, snapshot, accumulatorMs / TICK_MS);
    const c = snapshot.characters[DEFAULT_CHARACTER_ID]!;
    const visualCharacter = render.characters[DEFAULT_CHARACTER_ID]!;

    // Solo world: Props render straight from the local sim (no server
    // snapshot to pin them to), nobody remote to draw, nothing to spectate.
    stage.applyRenderState({ character: visualCharacter, props: render.props });
    stage.updateCharacterAnimation(
      // Same backgrounded-tab clamp as match play (`MAX_ANIMATION_DELTA_MS`
      // in `game/index.ts`) — animation delta only, never sim time.
      Math.min(elapsedMs, 100) / 1000,
      input.moveDirection,
      c.grounded,
      c.dashing,
      c.dashSpeed,
      c.hitEpoch,
      0,
      undefined,
      false,
    );
    stage.updateSpinners(snapshot.tick - 1 + accumulatorMs / TICK_MS);
    stage.updateCamera(visualCharacter.position, look.yaw, look.pitch);

    // The finish that reports instead of ending (m8.1 ticket 02) — position
    // in a finish trigger, read off the same resolved zones the stage
    // draws. The sim itself never learns (see above), so this fires without
    // side effects and the author runs on.
    const insideNow = resolved.finishZones.some((zone) => pointInOrientedBox(c.position, zone.trigger));
    if (shouldAnnounceFinish(finishAnnounced, insideNow)) {
      finishAnnounced = true;
      config.onPracticeState?.({ trackName, finished: true });
    } else if (!insideNow) {
      finishAnnounced = false;
    }

    stage.render();

    frameHandle = requestAnimationFrame(frame);
  };

  frameHandle = requestAnimationFrame(frame);

  // The full `GameHandle` shape so the shell needs no second handle type —
  // everything lobby-shaped is a documented no-op: a practice session has
  // no lobby, no host, no rounds to pick and nobody to send to.
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
  };
};
