import type { Vec3 } from "@dont-fall/shared";

/** Where an authored Track's Thumbnail is shot from (ADR 0105). */
export interface ThumbnailFrame {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees. Absent: the builder's own 55°. */
  fov?: number;
  /** The simulation Tick the moving pieces are posed at, so a sweep is caught mid-swing rather than at rest. */
  tick?: number;
}

/**
 * The framing of each code-authored Track's picture (ADR 0105), written down
 * the way the Track itself is. ADR 0085 turned down a fixed camera because it
 * frames every non-trivial Track badly, so each Track gets its own, picked by
 * looking at the render, as an author framing the builder's capture would.
 * Races look down the course from behind the Start, as the base race's does;
 * arenas are shot from above one rim.
 */
export const THUMBNAIL_FRAMES: Record<string, ThumbnailFrame> = {
  "spin-cycle": { position: { x: 12, y: 13, z: -58 }, target: { x: 0, y: 0, z: -100 }, tick: 45 },
  "slip-stream": { position: { x: 10, y: 12, z: -22 }, target: { x: 0, y: 3, z: -80 }, tick: 45 },
  "cog-arena": { position: { x: 21, y: 16, z: 23 }, target: { x: 0, y: -1, z: 0 }, tick: 45 },
  "sky-rings": { position: { x: 34, y: 26, z: 36 }, target: { x: 0, y: -2, z: 0 }, tick: 45 },
};
