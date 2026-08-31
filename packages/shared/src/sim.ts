import { TICK_DT } from "./tuning.js";
import { addVec3, scaleVec3, vec3, type Vec3 } from "./vec3.js";

/**
 * The full authoritative state of the simulation at one tick.
 *
 * M1 carries only a demo entity — the character, obstacles and track land in
 * later tickets. Everything here is plain data so a snapshot is a structured
 * clone away (ADR 0003).
 */
export interface SimState {
  tick: number;
  demo: {
    position: Vec3;
    velocity: Vec3;
  };
}

/** Per-tick inputs handed to {@link step}. M1 scaffold: a raw impulse on the demo entity. */
export interface SimInputs {
  impulse: Vec3;
}

/** The "no player acting this tick" input. Shared so client, server and tests agree on it. */
export const IDLE_INPUTS: SimInputs = { impulse: vec3() };

export const createInitialState = (): SimState => ({
  tick: 0,
  demo: {
    position: vec3(),
    velocity: vec3(),
  },
});

/**
 * Advance the simulation by exactly one {@link TICK_DT} tick.
 *
 * Pure with respect to `(state, inputs) -> state`: it never mutates its
 * arguments, so the client can re-run it for prediction and the server can run
 * it as the authority from the same code (ADR 0005).
 */
export const step = (state: SimState, inputs: SimInputs): SimState => {
  const next = structuredClone(state);
  next.tick += 1;

  next.demo.velocity = addVec3(next.demo.velocity, inputs.impulse);
  next.demo.position = addVec3(
    next.demo.position,
    scaleVec3(next.demo.velocity, TICK_DT),
  );

  return next;
};
