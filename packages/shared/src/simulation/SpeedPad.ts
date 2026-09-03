import type { OrientedBox } from "../math/box.js";

/**
 * A speed pad or a slow pad (CONTEXT.md) — one mechanism, not two (M3.7 ticket
 * 01, ADR 0035): a slow pad is a speed pad with {@link SpeedPadConfig.capMultiplier}
 * below 1 instead of above it. Fires once as a Character's capsule centre
 * enters `trigger` (re-armed the moment it leaves), the same containment
 * pipeline `Checkpoint` already proves works for rotated/tilted Segments
 * (`pointInOrientedBox`) — never a Volume (ADR 0036): a Volume applies a
 * continuous force, this is a one-shot, latched effect.
 */
export interface SpeedPadConfig {
  /** The region a Character's capsule centre must enter to trigger this pad. */
  trigger: OrientedBox;
  /**
   * Multiplies `WALK_SPEED` while this pad's effect is active (held, then
   * faded — {@link SPEED_PAD_HOLD_MS}/{@link SPEED_PAD_FADE_MS}). Above 1 for
   * a speed pad, below 1 for a slow pad; never exactly 1 (a no-op pad).
   */
  capMultiplier: number;
}
