import type { OrientedBox } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";

/**
 * A launch pad (CONTEXT.md — M3.7 ticket 02): a floor trigger that fires
 * once as a Character's capsule centre enters `trigger`, throwing it by
 * `velocity`. Re-arms the moment the Character leaves, the same
 * `findTriggerIndex` rising-edge pattern `Checkpoint` established. Contrast
 * with a bounce Surface (`Surface.ts`'s `SurfaceBounceConfig`), whose output
 * depends on the Character's own incoming velocity — a launch pad's vertical
 * half does not.
 *
 * **How the throw applies (ADR 0069): vertical is SET, horizontal is ADDED.**
 * The world-Y component replaces the Character's own outright, so the apex is
 * the authored height however the Character arrived (Unreal's `bZOverride`);
 * everything horizontal is added to the run it brought. This is a deliberate
 * divergence from Quake 3's `BG_TouchJumpPad`, which does `VectorCopy` — the
 * whole vector, "your incoming speed is discarded". That is right for an arena
 * shooter where the pad *is* the movement, and wrong for a platformer where
 * the run into the pad is the skill.
 */
export interface LaunchPadConfig {
  /** The region a Character's capsule centre must enter to trigger this pad. */
  trigger: OrientedBox;
  /**
   * The throw, authored in the owning Module's own local space (vertical SET,
   * horizontal ADDED — see above). `Track.ts`'s `resolveTrack` rotates (never
   * translates — this is a direction/magnitude, not a point) it into world
   * space by the placing Segment's own orientation, the same treatment a
   * Spinner's `initialAngle` gets.
   */
  velocity: Vec3;
}
