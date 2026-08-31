import type { SimState } from "./sim.js";
import { lerpVec3, type Vec3 } from "./vec3.js";

/**
 * What the renderer draws: the sim state visually interpolated toward the next
 * tick. Never fed back into the sim — presentation only (ADR 0004).
 */
export interface RenderState {
  demo: { position: Vec3 };
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
    demo: { position: lerpVec3(prev.demo.position, next.demo.position, t) },
  };
};
