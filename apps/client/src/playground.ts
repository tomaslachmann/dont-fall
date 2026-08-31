import type { Box, Checkpoint, Vec3 } from "@dont-fall/shared";

/**
 * The M1 scaffold playground: a run of platforms that step steadily downhill,
 * joined by narrow bridges you can be pushed off the sides of. No upward steps —
 * there is no jump until ticket 04. Ticket 03 adds the two Checkpoints; the
 * kill-plane is the shared `DEFAULT_KILL_PLANE_Y`. A later ticket replaces all of
 * this with a Segment-built Track.
 */

const box = (center: Vec3, halfExtents: Vec3): Box => ({ center, halfExtents });

export const PLAYGROUND_STATICS: Box[] = [
  box({ x: 0, y: -0.5, z: 10 }, { x: 4, y: 0.5, z: 4 }), // start platform, top y = 0
  box({ x: 0, y: -0.7, z: 4.5 }, { x: 1, y: 0.5, z: 2 }), // narrow bridge 1, top y = -0.2
  box({ x: 0, y: -1.1, z: -1 }, { x: 3, y: 0.5, z: 4 }), // checkpoint 1 platform, top y = -0.6
  box({ x: 0, y: -1.7, z: -6.5 }, { x: 1, y: 0.5, z: 2 }), // narrow bridge 2, top y = -1.2
  box({ x: 0, y: -2.6, z: -13 }, { x: 4, y: 0.5, z: 4.5 }), // checkpoint 2 / end platform, top y = -2.1
  box({ x: -3.2, y: 0.5, z: 10 }, { x: 0.4, y: 1.5, z: 3 }), // wall on the start platform
];

export const PLAYGROUND_SPAWN: Vec3 = { x: 0, y: 1.2, z: 10.5 };

export const PLAYGROUND_CHECKPOINTS: Checkpoint[] = [
  {
    respawn: { x: 0, y: 0.35, z: -1 },
    volume: { center: { x: 0, y: 0.35, z: -1 }, halfExtents: { x: 2.5, y: 2, z: 3.5 } },
  },
  {
    respawn: { x: 0, y: -1.15, z: -13 },
    volume: { center: { x: 0, y: -1.15, z: -13 }, halfExtents: { x: 3.5, y: 2, z: 4 } },
  },
];
