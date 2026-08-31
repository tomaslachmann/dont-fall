import {
  TICK_MS,
  TICK_RATE_HZ,
  RapierSimulation,
  advanceFixed,
  initPhysics,
  interpolateState,
  movementDirection,
  type SimState,
} from "@dont-fall/shared";
import { KeyboardInput, PointerOrbit } from "./input.js";
import { PLAYGROUND_SPAWN, PLAYGROUND_STATICS } from "./playground.js";
import { createStage } from "./scene.js";

const main = async () => {
  const hud = document.getElementById("hud")!;
  await initPhysics();

  const simulation = new RapierSimulation({
    spawn: PLAYGROUND_SPAWN,
    statics: PLAYGROUND_STATICS,
  });
  const stage = createStage(simulation.getStatics());
  const keyboard = new KeyboardInput();
  const orbit = new PointerOrbit(stage.domElement);

  let accumulatorMs = 0;
  let previousSnapshot: SimState = simulation.snapshot();
  let lastFrame = performance.now();
  let fps = 0;

  const frame = (now: number) => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;
    fps += (1000 / Math.max(elapsedMs, 1) - fps) * 0.1;

    const moveDirection = movementDirection(keyboard.movementKeys(), orbit.yaw);
    const result = advanceFixed({
      simulation,
      input: { moveDirection },
      accumulatorMs,
      elapsedMs,
      previousSnapshot,
    });
    accumulatorMs = result.accumulatorMs;
    previousSnapshot = result.previousSnapshot;

    const alpha = accumulatorMs / TICK_MS;
    const render = interpolateState(result.previousSnapshot, result.snapshot, alpha);
    stage.applyRenderState(render);
    stage.updateCamera(render.character.position, orbit.yaw, orbit.pitch);
    stage.render();

    const c = result.snapshot.character;
    hud.textContent =
      `DON'T FALL — M1 · walk\n` +
      `sim ${TICK_RATE_HZ} Hz · render ${fps.toFixed(0)} fps · tick ${result.snapshot.tick}\n` +
      `pos ${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)}, ${c.position.z.toFixed(1)} · grounded ${c.grounded}\n` +
      `WASD move · drag mouse to orbit`;

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
};

void main();
