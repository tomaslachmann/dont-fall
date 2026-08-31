import {
  DEMO_DRIFT_SPEED,
  IDLE_INPUTS,
  TICK_MS,
  TICK_RATE_HZ,
  advanceFixed,
  createInitialState,
  interpolateState,
  step,
  type SimState,
} from "@dont-fall/shared";
import { createStage } from "./scene.js";

const stage = createStage();
const hud = document.getElementById("hud")!;

// The sim is authoritative over motion; the renderer only ever interpolates it.
let sim: SimState = createInitialState();
sim.demo.velocity = { x: DEMO_DRIFT_SPEED, y: 0, z: 0 }; // drifts so smoothness is visible
let prevSim: SimState = sim;

let accumulatorMs = 0;
let lastFrame = performance.now();
let fps = 0;

const frame = (now: number) => {
  const elapsedMs = now - lastFrame;
  lastFrame = now;
  fps += (1000 / Math.max(elapsedMs, 1) - fps) * 0.1;

  const result = advanceFixed({
    accumulatorMs,
    elapsedMs,
    state: sim,
    previousState: prevSim,
    step: (s) => step(s, IDLE_INPUTS),
  });
  sim = result.state;
  prevSim = result.previousState;
  accumulatorMs = result.accumulatorMs;

  // Fraction of a tick we are past `prevSim` — the renderer lives one tick in the past.
  const alpha = accumulatorMs / TICK_MS;
  stage.applyRenderState(interpolateState(prevSim, sim, alpha));
  stage.render();

  hud.textContent =
    `DON'T FALL — M1 scaffold\n` +
    `sim ${TICK_RATE_HZ} Hz · render ${fps.toFixed(0)} fps\n` +
    `tick ${sim.tick} · steps/frame ${result.steps} · alpha ${alpha.toFixed(2)}`;

  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
