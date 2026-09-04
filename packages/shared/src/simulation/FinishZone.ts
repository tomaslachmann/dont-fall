import type { OrientedBox } from "../math/box.js";

/**
 * A Finish Zone: the area at the end of a Race that grants Qualification on
 * entry (CONTEXT.md, ADR 0039).
 *
 * Deliberately an area rather than a line, so the end of a Round stays
 * chaotic and contested — two Characters can arrive together and shove each
 * other through it.
 *
 * Shaped exactly like a {@link Checkpoint}'s `trigger` and detected through
 * the same rotation-safe `orientBox` → `pointInOrientedBox` pipeline, so a
 * Finish Zone on a rotated or tilted Segment is correct without a second
 * containment implementation. It is detection-only: it never pushes (so it is
 * never a Volume, ADR 0036) and never respawns (so it carries no respawn
 * point, and a Checkpoint never doubles as one, ADR 0039).
 *
 * A single-field interface rather than a bare `OrientedBox` on purpose: it
 * matches the `{ trigger }` shape every other one-shot trigger entity here
 * has (`SpeedPadConfig`, `LaunchPadConfig`, `Checkpoint`), which is what lets
 * `RapierSimulation.findTriggerIndex` scan it unchanged.
 */
export interface FinishZone {
  /** The region a Character's capsule centre must enter to Qualify. */
  trigger: OrientedBox;
}
