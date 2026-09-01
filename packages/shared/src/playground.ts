import type { Box } from "./math/box.js";
import type { Vec3 } from "./math/vec3.js";
import type { Checkpoint } from "./simulation/Checkpoint.js";
import type { PropConfig } from "./simulation/Prop.js";
import type { SpinnerConfig } from "./simulation/Spinner.js";

/**
 * The M1 scaffold playground: a run of platforms that step steadily downhill,
 * joined by narrow bridges you can be pushed off the sides of. No upward steps —
 * there is no jump until ticket 04. Ticket 03 adds the two Checkpoints; the
 * kill-plane is the shared `DEFAULT_KILL_PLANE_Y`. Ticket 06 adds one Spinner on
 * the Checkpoint 1 platform and a few Props on the end platform. A later ticket
 * replaces all of this with a Segment-built Track.
 *
 * Lives in `packages/shared` (not the client) since ticket 02: the server's
 * authoritative `RapierSimulation` and the client's scene-building both need
 * the exact same level geometry.
 */

const box = (center: Vec3, halfExtents: Vec3): Box => ({ center, halfExtents });

export const PLAYGROUND_STATICS: Box[] = [
  box({ x: 0, y: -0.5, z: 10 }, { x: 4, y: 0.5, z: 4 }), // start platform, top y = 0
  box({ x: 0, y: -0.7, z: 4.5 }, { x: 1, y: 0.5, z: 2 }), // narrow bridge 1, top y = -0.2
  box({ x: 0, y: -1.1, z: -1 }, { x: 3, y: 0.5, z: 4 }), // checkpoint 1 platform, top y = -0.6
  box({ x: 0, y: -1.7, z: -6.5 }, { x: 1, y: 0.5, z: 2 }), // narrow bridge 2, top y = -1.2
  box({ x: 0, y: -2.6, z: -13 }, { x: 4, y: 0.5, z: 4.5 }), // checkpoint 2 / end platform, top y = -2.1
  box({ x: -3.2, y: 0.5, z: 10 }, { x: 0.4, y: 1.5, z: 3 }), // wall on the start platform
  // Open sandbox past the end platform (ticket 07 playtest) — flush with its
  // top (y = -2.1), 30x30, plenty of clear room for dash/jump/spinner testing.
  box({ x: 0, y: -2.6, z: -32 }, { x: 15, y: 0.5, z: 15 }),
];

export const PLAYGROUND_SPAWN: Vec3 = { x: 0, y: 1.2, z: 10.5 };

/**
 * Per-player spawn point on the start platform (M2 ticket 04): players are
 * solid to each other now, so two joining at the same spot would spawn
 * interpenetrating. Laid out as a grid across the platform (clear of the
 * x = -3.2 wall), wrapping after 12 — the ADR 0011 player ceiling.
 */
export const playgroundSpawn = (index: number): Vec3 => {
  const slot = ((index % 12) + 12) % 12;
  const col = slot % 4; // 4 across
  const row = Math.floor(slot / 4); // up to 3 back
  return { x: -1.8 + col * 1.2, y: PLAYGROUND_SPAWN.y, z: PLAYGROUND_SPAWN.z - row * 1.5 };
};

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

/**
 * One rotating bar on the Checkpoint 1 platform (top y = -0.6), clear of the
 * Checkpoint volume. `angularSpeed` (ticket 07 feel pass) is tuned so a tip
 * hit clears IMPACT_RAGDOLL_MIN (a real knockdown) while a graze near the
 * axle stays in IMPACT_STAGGER_MIN territory — at 2.5 rad/s the tip alone
 * never broke Stagger, so the bar was all bark, no bite.
 */
export const PLAYGROUND_SPINNERS: SpinnerConfig[] = [
  {
    center: { x: 0, y: -0.05, z: 1 },
    armLength: 2.5,
    halfHeight: 0.4,
    armRadius: 0.35,
    angularSpeed: 6.5,
  },
];

/** A few dynamic props scattered on the end platform (top y = -2.1) to bump and knock around. */
export const PLAYGROUND_PROPS: PropConfig[] = [
  { shape: { kind: "box", halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }, center: { x: -1.5, y: -1.7, z: -13 } },
  { shape: { kind: "ball", radius: 0.4 }, center: { x: 1.5, y: -1.7, z: -13 } },
  { shape: { kind: "box", halfExtents: { x: 0.35, y: 0.35, z: 0.35 } }, center: { x: 0, y: -1.75, z: -15.5 } },
];
