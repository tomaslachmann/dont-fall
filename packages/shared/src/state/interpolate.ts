import { slerpQuat } from "../math/quat.js";
import { lerpVec3, type Vec3 } from "../math/vec3.js";
import type { BoneSnapshot } from "../simulation/Ragdoll.js";
import type { SimState } from "./SimState.js";

/**
 * What the renderer draws: sim state visually interpolated toward the next tick.
 * Never fed back into the simulation — presentation only (ADR 0004).
 */
export interface RenderState {
  character: {
    position: Vec3;
    /** Empty unless the Character is ragdolling / getting up. */
    bones: BoneSnapshot[];
  };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

const interpolateBones = (
  prev: BoneSnapshot[],
  next: BoneSnapshot[],
  t: number,
): BoneSnapshot[] =>
  next.map((n, i) => {
    const p = prev[i] ?? n;
    return { position: lerpVec3(p.position, n.position, t), rotation: slerpQuat(p.rotation, n.rotation, t) };
  });

/**
 * Blend between the two most recent sim states by `alpha` (the fraction of a
 * tick the renderer is past `prev`). `alpha` is clamped to [0, 1].
 *
 * A discontinuity — a Respawn teleport, or a motion-state change that swaps the
 * body being drawn (capsule ↔ ragdoll) — cannot be blended through, so the
 * `next` pose is used directly.
 */
export const interpolateState = (
  prev: SimState,
  next: SimState,
  alpha: number,
): RenderState => {
  const snap =
    next.character.teleported || prev.character.motionState !== next.character.motionState;
  const t = snap ? 1 : clamp01(alpha);

  return {
    character: {
      position: lerpVec3(prev.character.position, next.character.position, t),
      bones: t === 1
        ? next.character.bones.map((b) => ({ position: { ...b.position }, rotation: { ...b.rotation } }))
        : interpolateBones(prev.character.bones, next.character.bones, t),
    },
  };
};
