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
  /** Index of the last Checkpoint reached, or `null` if only the spawn point is set. */
  checkpointIndex: number | null;
  /** How many times this Character has Fallen and Respawned. */
  fallCount: number;
  /** True while frozen at a Checkpoint after a Respawn (the Fall penalty). */
  respawning: boolean;
  /**
   * True only on the tick a Respawn teleported the Character. The renderer must
   * snap rather than interpolate through this frame.
   */
  teleported: boolean;
}

export interface CharacterSnapshotFields {
  position: Vec3;
  grounded?: boolean;
  checkpointIndex?: number | null;
  fallCount?: number;
  respawning?: boolean;
  teleported?: boolean;
}

export const characterSnapshot = (fields: CharacterSnapshotFields): CharacterSnapshot => ({
  position: { ...fields.position },
  grounded: fields.grounded ?? false,
  motionState: "Controlled",
  checkpointIndex: fields.checkpointIndex ?? null,
  fallCount: fields.fallCount ?? 0,
  respawning: fields.respawning ?? false,
  teleported: fields.teleported ?? false,
});

/**
 * The observable state of the world at one tick — a plain, fully serialisable
 * POJO. It is the network snapshot and the interpolation source, and it holds no
 * Rapier handles (ADR 0009).
 */
export interface SimState {
  tick: number;
  character: CharacterSnapshot;
}
