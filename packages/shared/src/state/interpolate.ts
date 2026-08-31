import { lerpVec3, type Vec3 } from "../math/vec3.js";
import type { SimState } from "./SimState.js";

/**
 * What the renderer draws: sim state visually interpolated toward the next tick.
 * Never fed back into the simulation — presentation only (ADR 0004).
 */
export interface RenderState {
  character: { position: Vec3 };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Blend between the two most recent sim states by `alpha` (the fraction of a
 * tick the renderer is past `prev`). `alpha` is clamped to [0, 1].
 */
export const interpolateState = (
  prev: SimState,
  next: SimState,
  alpha: number,
): RenderState => {
  const t = clamp01(alpha);
  return {
    character: {
      position: lerpVec3(prev.character.position, next.character.position, t),
    },
  };
};
