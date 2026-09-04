import type { OrientedBox } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";

/**
 * A Volume (CONTEXT.md): a region of space that applies a continuous force
 * to any Character inside it — an updraft, a wind tunnel. Its own entity
 * kind, never a collider wearing a special material (ADR 0036): `bounds`
 * reuses the exact containment pipeline a Checkpoint's `trigger` already
 * proves works (`pointInOrientedBox`, correct for rotated/tilted Segments
 * since ADR 0034). Deliberately not called `trigger` (CONTEXT.md's own
 * avoid-list for Volume) — a Volume never latches or fires once; it applies
 * its force every tick a Character's capsule centre is inside it, and stops
 * the instant it isn't, with no state of its own to remember in between.
 */
export interface VolumeConfig {
  /** The region a Character's capsule centre must be inside for this Volume's force to apply. */
  bounds: OrientedBox;
  /**
   * Acceleration (units/s²) applied to a contained Character's velocity every
   * tick, authored in the owning Module's own local space — rotated (never
   * translated — a direction/magnitude, not a point) into world space by
   * `Track.ts`'s `resolveTrack`, the same treatment a launch pad's `velocity`
   * gets.
   */
  force: Vec3;
  /**
   * Never exceeded, along `force`'s own direction, however long a Character
   * stays inside — a wind Volume with no cap is an unbounded integrator.
   * Gravity (and everything else already acting on the Character) keeps
   * acting independently, so the Character's actual net speed along that
   * axis can still sit below this if something else is pulling the other way
   * — this only ever caps this Volume's own contribution.
   */
  maxInducedSpeed: number;
  /**
   * Where two or more Volumes' `bounds` overlap, the highest `priority` wins
   * outright and every other overlapping Volume is ignored for that
   * Character this tick — never summed (ADR 0036, Unreal's own rule).
   * Summing turns an authoring mistake (two Volumes placed carelessly close)
   * into what looks like a physics bug. Ties resolve to whichever Volume
   * sorts first in `Module.volumes`/the resolved Track's own array order —
   * deterministic, never a source of desync.
   */
  priority: number;
}
