import {
  DASH_COOLDOWN_MS,
  DEFAULT_KILL_PLANE_Y,
  TICK_MS,
  TICK_RATE_HZ,
  RapierSimulation,
  advanceFixed,
  initPhysics,
  interpolateState,
  movementDirection,
  type SimState,
} from "@dont-fall/shared";
import { loadCharacterModel } from "./characterModel.js";
import { FreeLookCamera, KeyboardInput } from "./input.js";
import {
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPAWN,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
} from "./playground.js";
import { createStage } from "./scene.js";

/**
 * Cap on the per-frame delta fed to the Character model's animation/facing
 * update. `advanceFixed` already bounds how many sim ticks a stalled frame
 * can catch up on; this bounds the render-only animation step the same way,
 * so a backgrounded-tab refocus can't snap the facing or jump the clip.
 */
const MAX_ANIMATION_DELTA_MS = 100;

const main = async () => {
  const hud = document.getElementById("hud")!;
  const lockPrompt = document.getElementById("lock-prompt")!;
  const [, characterModel] = await Promise.all([initPhysics(), loadCharacterModel()]);

  const simulation = new RapierSimulation({
    spawn: PLAYGROUND_SPAWN,
    statics: PLAYGROUND_STATICS,
    checkpoints: PLAYGROUND_CHECKPOINTS,
    spinners: PLAYGROUND_SPINNERS,
    props: PLAYGROUND_PROPS,
  });
  const stage = createStage({
    statics: simulation.getStatics(),
    checkpoints: simulation.getCheckpoints(),
    killPlaneY: DEFAULT_KILL_PLANE_Y,
    spinners: simulation.getSpinners(),
    props: simulation.getProps(),
    characterModel,
  });
  const keyboard = new KeyboardInput();
  const look = new FreeLookCamera(stage.domElement);

  let accumulatorMs = 0;
  let previousSnapshot: SimState = simulation.snapshot();
  let lastFrame = performance.now();
  let fps = 0;

  const frame = (now: number) => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;
    fps += (1000 / Math.max(elapsedMs, 1) - fps) * 0.1;

    const moveDirection = movementDirection(keyboard.movementKeys(), look.yaw);
    const result = advanceFixed({
      simulation,
      input: {
        moveDirection,
        jumpHeld: keyboard.jumpHeld(),
        dashHeld: keyboard.dashHeld(),
      },
      accumulatorMs,
      elapsedMs,
      previousSnapshot,
    });
    accumulatorMs = result.accumulatorMs;
    previousSnapshot = result.previousSnapshot;

    const alpha = accumulatorMs / TICK_MS;
    const render = interpolateState(result.previousSnapshot, result.snapshot, alpha);
    stage.applyRenderState(render);
    stage.updateCharacterAnimation(
      Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000,
      moveDirection,
      result.snapshot.character.grounded,
      result.snapshot.character.dashing,
    );
    stage.updateSpinners(result.previousSnapshot.tick + alpha);
    stage.updateCamera(render.character.position, look.yaw, look.pitch);
    stage.render();

    lockPrompt.hidden = look.locked;

    const c = result.snapshot.character;
    const cp = c.checkpointIndex === null ? "spawn" : `#${c.checkpointIndex + 1}`;
    const dashFill = Math.max(0, Math.min(10, Math.round((1 - c.dashCooldownMs / DASH_COOLDOWN_MS) * 10)));
    const dashBar = "#".repeat(dashFill) + "-".repeat(10 - dashFill);
    hud.textContent =
      `DON'T FALL — M1 · ragdoll\n` +
      `sim ${TICK_RATE_HZ} Hz · render ${fps.toFixed(0)} fps · tick ${result.snapshot.tick}\n` +
      `pos ${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)}, ${c.position.z.toFixed(1)} · ${c.motionState}\n` +
      `checkpoint ${cp} · falls ${c.fallCount}\n` +
      `dash [${dashBar}]${c.dashCooldownMs === 0 ? " ready" : ""}\n` +
      `WASD move · Space jump · Shift dash · mouse look`;

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
};

void main();
