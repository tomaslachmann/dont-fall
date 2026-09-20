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
  "cog-arena": { position: { x: 25, y: 18, z: 27 }, target: { x: 0, y: -0.5, z: 0 }, tick: 45 },
  "sky-rings": { position: { x: 34, y: 26, z: 36 }, target: { x: 0, y: -2, z: 0 }, tick: 45 },
};

/** The vertical field of view the auto-frame fits against — the builder viewport's own 55°. */
export const AUTO_FRAME_FOV = 55;

/** A draft's Motions are posed mid-swing, like every authored frame's tick 45. */
export const AUTO_FRAME_TICK = 45;

/**
 * Frames any Track with no authored entry (ADR 0114, D10): the whole
 * Segment bbox from behind-above the Start side (+Z looking −Z, the way
 * Tracks chain), Motions posed mid-swing. A long Race reads as an overview,
 * not a detail — the backstop answers "did it land where I meant", the
 * builder answers the rest. Pure, so the thumbnail page and any caller frame
 * identically.
 */
export const frameTrackAuto = (track: readonly { position: Vec3 }[]): ThumbnailFrame => {
  if (track.length === 0) {
    return { position: { x: 8, y: 7, z: 14 }, target: { x: 0, y: 0, z: 0 }, fov: AUTO_FRAME_FOV, tick: AUTO_FRAME_TICK };
  }
  let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
  let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
  for (const { position } of track) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    minZ = Math.min(minZ, position.z);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
    maxZ = Math.max(maxZ, position.z);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  const radius = Math.max(
    3,
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
  );
  const distance = (radius / Math.tan(((AUTO_FRAME_FOV / 2) * Math.PI) / 180)) * 1.1;
  const dir = { x: 0.4, y: 0.62, z: 1 };
  const length = Math.hypot(dir.x, dir.y, dir.z);
  return {
    position: {
      x: center.x + (dir.x / length) * distance,
      y: center.y + (dir.y / length) * distance,
      z: center.z + (dir.z / length) * distance,
    },
    target: center,
    fov: AUTO_FRAME_FOV,
    tick: AUTO_FRAME_TICK,
  };
};
