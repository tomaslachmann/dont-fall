import type { OrientedBox } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";

/**
 * A Checkpoint: a trigger the Character walks through to set its respawn
 * point, plus where the Respawn puts it (CONTEXT.md).
 */
export interface Checkpoint {
  /** Where the Character reappears after a Fall (capsule centre). */
  respawn: Vec3;
  /**
   * The region the Character's capsule centre must enter to activate this
   * Checkpoint — a detection-only trigger, never a Volume (ADR 0036: `Volume`
   * is reserved for a region that applies a force; a Checkpoint's own region
   * only detects, so it is never called a Volume). Carries a rotation (ADR
   * 0034 code review) so a Checkpoint inside a rotated/tilted Segment's
   * Module still detects containment correctly — `pointInOrientedBox`
   * un-rotates the query point rather than approximating with an axis-aligned
   * box.
   */
  trigger: OrientedBox;
}
