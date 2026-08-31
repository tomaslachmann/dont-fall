import type { StaticBox, Vec3 } from "@dont-fall/shared";

/**
 * The M1 scaffold playground: ground, one raised platform to walk onto, and a
 * wall to bump into and test camera collision against. Ticket 03 replaces this
 * with a real Segment-built Track.
 */
export const PLAYGROUND_STATICS: StaticBox[] = [
  { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 25, y: 0.5, z: 25 } }, // ground
  { center: { x: 6, y: 0.4, z: -4 }, halfExtents: { x: 3, y: 0.4, z: 3 } }, // platform
  { center: { x: -5, y: 1.5, z: 2 }, halfExtents: { x: 0.4, y: 1.5, z: 6 } }, // wall
];

export const PLAYGROUND_SPAWN: Vec3 = { x: 0, y: 2, z: 6 };
