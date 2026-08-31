import { slerpQuat, type Quat } from "../math/quat.js";
import { lerpVec3, type Vec3 } from "../math/vec3.js";
import type { PropSnapshot } from "../simulation/Prop.js";
import type { BoneSnapshot } from "../simulation/ragdollSkeleton.js";
import type { SimState } from "./SimState.js";

interface Posed {
  position: Vec3;
  rotation: Quat;
}

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
  /** Per-Prop pose, in `SimState.props` order. */
  props: PropSnapshot[];
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

const interpolatePosed = <T extends Posed>(prev: T[], next: T[], t: number): T[] =>
  next.map((n, i) => {
    const p = prev[i] ?? n;
    return { ...n, position: lerpVec3(p.position, n.position, t), rotation: slerpQuat(p.rotation, n.rotation, t) };
  });

/**
 * Blend between the two most recent sim states by `alpha` (the fraction of a
 * tick the renderer is past `prev`). `alpha` is clamped to [0, 1].
 *
 * A discontinuity cannot be blended through, so the `next` pose is used directly:
 * a Respawn teleport, or a frame where the drawn body swaps (the bone count goes
 * 0 ↔ N, i.e. capsule ↔ ragdoll). `Controlled ↔ Stagger` and `Ragdoll ↔
 * GettingUp` both keep the same body and interpolate normally.
 */
export const interpolateState = (
  prev: SimState,
  next: SimState,
  alpha: number,
): RenderState => {
  const bodySwapped = prev.character.bones.length !== next.character.bones.length;
  const t = next.character.teleported || bodySwapped ? 1 : clamp01(alpha);

  return {
    character: {
      position: lerpVec3(prev.character.position, next.character.position, t),
      bones: t === 1
        ? next.character.bones.map((b) => ({ position: { ...b.position }, rotation: { ...b.rotation } }))
        : interpolatePosed(prev.character.bones, next.character.bones, t),
    },
    props: interpolatePosed(prev.props, next.props, clamp01(alpha)),
  };
};
