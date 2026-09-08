import { lerpAngle } from "../math/angle.js";
import { slerpQuat, type Quat } from "../math/quat.js";
import { lerpVec3, type Vec3 } from "../math/vec3.js";
import type { CharacterMotionState } from "../simulation/CharacterStateMachine.js";
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
export interface RenderCharacter {
  position: Vec3;
  /** Empty unless the Character is ragdolling / getting up. */
  bones: BoneSnapshot[];
  /** Not interpolated — a discrete state, taken straight from `next`. */
  motionState: CharacterMotionState;
  /**
   * World-space yaw in radians (M6, ADR 0045) — interpolated by the shortest
   * arc (never a plain lerp, which would spin the long way around the +/-PI
   * seam), on the same discontinuities `position` snaps on. Orients a remote
   * Character's rendered model (ADR 0046).
   */
  facing: number;
  /**
   * Not interpolated — taken straight from `next`, like `motionState`. Drives
   * a remote Character's locomotion animation selection (ADR 0046); no
   * visual quantity needs it smoothed, only the discrete idle/walk/run/jump
   * decision it feeds.
   */
  velocity: Vec3;
  grounded: boolean;
  dashing: boolean;
  /** Not interpolated — the Epoch idiom, diffed against the last-seen value to trigger the Punch animation exactly once (M6 ticket 03, ADR 0046). */
  hitEpoch: number;
  /** Not interpolated — same idiom, triggers the HitReact animation exactly once. */
  hitReactEpoch: number;
}

export interface RenderState {
  /** Every Character in the Match, keyed the same way as `SimState.characters`. */
  characters: Record<string, RenderCharacter>;
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
 * tick the renderer is past `prev`), independently per Character.
 *
 * A discontinuity cannot be blended through, so the `next` pose is used directly:
 * a Respawn teleport, or a frame where the drawn body swaps (the bone count goes
 * 0 ↔ N, i.e. capsule ↔ ragdoll). `Controlled ↔ Stagger` and `Ragdoll ↔
 * GettingUp` both keep the same body and interpolate normally. A Character
 * present in `next` but not yet in `prev` (just added) renders at its `next`
 * pose with no blend, the same as any other discontinuity.
 */
export const interpolateState = (
  prev: SimState,
  next: SimState,
  alpha: number,
): RenderState => {
  const characters: Record<string, RenderCharacter> = {};
  for (const [id, n] of Object.entries(next.characters)) {
    const p = prev.characters[id] ?? n;
    const bodySwapped = p.bones.length !== n.bones.length;
    const t = n.respawnCount !== p.respawnCount || bodySwapped ? 1 : clamp01(alpha);

    characters[id] = {
      position: lerpVec3(p.position, n.position, t),
      bones: t === 1
        ? n.bones.map((b) => ({ position: { ...b.position }, rotation: { ...b.rotation } }))
        : interpolatePosed(p.bones, n.bones, t),
      motionState: n.motionState,
      facing: lerpAngle(p.facing, n.facing, t),
      velocity: { ...n.velocity },
      grounded: n.grounded,
      dashing: n.dashing,
      hitEpoch: n.hitEpoch,
      hitReactEpoch: n.hitReactEpoch,
    };
  }

  return { characters, props: interpolatePosed(prev.props, next.props, clamp01(alpha)) };
};
