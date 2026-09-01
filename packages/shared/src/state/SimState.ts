import type { Vec3 } from "../math/vec3.js";
import type { CharacterMotionState } from "../simulation/CharacterStateMachine.js";
import type { PropSnapshot } from "../simulation/Prop.js";
import type { BoneSnapshot } from "../simulation/ragdollSkeleton.js";

export type { CharacterMotionState, BoneSnapshot, PropSnapshot };

export interface CharacterSnapshot {
  /** The point the camera follows: capsule centre while upright, pelvis while ragdolling. */
  position: Vec3;
  /** Whether the character controller reported ground contact last tick. */
  grounded: boolean;
  motionState: CharacterMotionState;
  /** Index of the last Checkpoint reached, or `null` if only the spawn point is set. */
  checkpointIndex: number | null;
  /** How many times this Character has Fallen and Respawned. */
  fallCount: number;
  /**
   * True only on the tick a Respawn teleported the Character. The renderer must
   * snap rather than interpolate through this frame.
   */
  teleported: boolean;
  /** Milliseconds left on the Dash cooldown; 0 means Dash is ready. */
  dashCooldownMs: number;
  /** Whether a Dash burst is currently playing out (as opposed to merely on cooldown). */
  dashing: boolean;
  /** Current horizontal speed (units/s) contributed by an active Dash burst; 0 when not dashing. */
  dashSpeed: number;
  /**
   * Per-bone transforms while `motionState` is `Ragdoll` or `GettingUp`, in
   * `RAGDOLL_BONES` order; empty otherwise (the renderer draws the capsule).
   */
  bones: BoneSnapshot[];
}

/**
 * The observable state of the world at one tick — a plain, fully serialisable
 * POJO. It is the network snapshot and the interpolation source, and it holds no
 * Rapier handles (ADR 0009).
 */
export interface SimState {
  tick: number;
  /** Every Character in the Match, keyed by an ID assigned when it was added (ticket 01). */
  characters: Record<string, CharacterSnapshot>;
  /**
   * Per-Prop pose, in the same order every tick (ticket 06). A Spinner's pose
   * is not carried here — it is a pure function of `tick`, so the renderer
   * recomputes it directly instead (`spinnerAngleAt`).
   */
  props: PropSnapshot[];
}

export interface CharacterSnapshotFields {
  position: Vec3;
  grounded?: boolean;
  motionState?: CharacterMotionState;
  checkpointIndex?: number | null;
  fallCount?: number;
  teleported?: boolean;
  dashCooldownMs?: number;
  dashing?: boolean;
  dashSpeed?: number;
  bones?: BoneSnapshot[];
}

export const characterSnapshot = (fields: CharacterSnapshotFields): CharacterSnapshot => ({
  position: { ...fields.position },
  grounded: fields.grounded ?? false,
  motionState: fields.motionState ?? "Controlled",
  checkpointIndex: fields.checkpointIndex ?? null,
  fallCount: fields.fallCount ?? 0,
  teleported: fields.teleported ?? false,
  dashCooldownMs: fields.dashCooldownMs ?? 0,
  dashing: fields.dashing ?? false,
  dashSpeed: fields.dashSpeed ?? 0,
  bones: fields.bones ?? [],
});
