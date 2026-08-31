import type { Vec3 } from "../math/vec3.js";

/**
 * The Character's motion state (ADR 0006). Only `Controlled` exists until the
 * ragdoll state machine lands in ticket 05.
 */
export type CharacterMotionState = "Controlled";

export interface CharacterSnapshot {
  /** Capsule centre in world space. */
  position: Vec3;
  /** Whether the character controller reported ground contact last tick. */
  grounded: boolean;
  motionState: CharacterMotionState;
}

/**
 * The observable state of the world at one tick — a plain, fully serialisable
 * POJO. It is the network snapshot and the interpolation source, and it holds no
 * Rapier handles (ADR 0009).
 */
export interface SimState {
  tick: number;
  character: CharacterSnapshot;
}

export const characterSnapshot = (
  position: Vec3,
  grounded = false,
): CharacterSnapshot => ({
  position: { ...position },
  grounded,
  motionState: "Controlled",
});
