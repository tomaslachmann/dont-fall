import type { OrientedBox } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";
import type { PlacedGate } from "../track/Gate.js";

/**
 * A Checkpoint: where the Respawn puts a Character, and how it is reached
 * (CONTEXT.md) — passing through a Gate's opening (ADR 0068), or, on a
 * retired checkpoint block, entering its trigger region.
 */
export type Checkpoint = TriggerCheckpoint | GateCheckpoint;

/** A Checkpoint reached through a Gate switched on as one (ADR 0068). */
export interface GateCheckpoint {
  /** Where the Character reappears after a Fall (capsule centre). */
  respawn: Vec3;
  gate: PlacedGate;
  trigger?: undefined;
}

/** A retired checkpoint block's Checkpoint: entered, not passed through. */
export interface TriggerCheckpoint {
  gate?: undefined;
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
