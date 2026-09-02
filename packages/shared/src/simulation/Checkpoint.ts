import type { OrientedBox } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";

/**
 * A Checkpoint: a trigger volume the Character walks through to set its respawn
 * point, plus where the Respawn puts it (CONTEXT.md).
 */
export interface Checkpoint {
  /** Where the Character reappears after a Fall (capsule centre). */
  respawn: Vec3;
  /**
   * The volume the Character's capsule centre must enter to activate this
   * Checkpoint. Carries a rotation (ADR 0034 code review) so a Checkpoint
   * inside a rotated/tilted Segment's Module still detects containment
   * correctly — `pointInOrientedBox` un-rotates the query point rather than
   * approximating with an axis-aligned box.
   */
  volume: OrientedBox;
}
