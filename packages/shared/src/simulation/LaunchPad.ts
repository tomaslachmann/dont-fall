import type { OrientedBox } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";

/**
 * A launch pad (CONTEXT.md — M3.7 ticket 02): a floor trigger that fires
 * once as a Character's capsule centre enters `trigger`, setting its
 * velocity outright to `velocity` — Quake 3's jump-pad model
 * (`BG_TouchJumpPad`: `VectorCopy`, not an add — "your incoming speed is
 * discarded"). Re-arms the moment the Character leaves, the same
 * `findTriggerIndex` rising-edge pattern `SpeedPad` established. Contrast
 * with a bounce Surface (`Surface.ts`'s `SurfaceBounceConfig`), whose output
 * depends on the Character's own incoming velocity — a launch pad's does not.
 */
export interface LaunchPadConfig {
  /** The region a Character's capsule centre must enter to trigger this pad. */
  trigger: OrientedBox;
  /**
   * The velocity to SET on trigger, authored in the owning Module's own
   * local space — `Track.ts`'s `resolveTrack` rotates (never translates —
   * this is a direction/magnitude, not a point) it into world space by the
   * placing Segment's own orientation, the same treatment a Spinner's
   * `initialAngle` gets.
   */
  velocity: Vec3;
}
