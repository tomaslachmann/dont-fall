import {
  IDLE_INPUTS,
  addVec3,
  dotVec3,
  movementDirection,
  normalizeVec3,
  scaleVec3,
  subVec3,
  type SimInputs,
  type Vec3,
} from "../packages/shared/src/index.js";

/**
 * A Character that runs down the course: forward along the Start, steered
 * back toward the line it started on, jumping and dashing on its own
 * staggered beat. It falls often — that is load too.
 *
 * The M13 benchmark's bots (`bench-simulation.ts`), shared with the sound
 * budget's 12-Character run (M14 ticket 13) so both measure the same Round.
 */
export const scriptedInput = (index: number, tick: number, position: Vec3, lineOrigin: Vec3, yaw: number): SimInputs => {
  const forward = movementDirection({ forward: true, back: false, left: false, right: false }, yaw);
  const right = movementDirection({ forward: false, back: false, left: false, right: true }, yaw);
  const lateral = dotVec3(subVec3(position, lineOrigin), right);
  const steer = Math.max(-0.8, Math.min(0.8, -lateral / 4));
  const beat = tick + index * 7;
  return {
    ...IDLE_INPUTS,
    moveDirection: normalizeVec3(addVec3(forward, scaleVec3(right, steer))),
    jumpHeld: beat % 45 < 8,
    dashHeld: beat % 120 === 0,
    facing: yaw,
  };
};
