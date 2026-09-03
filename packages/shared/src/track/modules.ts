import type { Footprint, Module, Socket } from "./Module.js";
import { chainTrack, type Track } from "./Track.js";

const box = (center: { x: number; y: number; z: number }, halfExtents: { x: number; y: number; z: number }) => ({
  center,
  halfExtents,
});

/**
 * Every current Module is a straight corridor: an `entry` Socket at the near
 * edge (facing back the way you came, yaw π) and an `exit` Socket at the far
 * edge (facing onward, yaw 0), 6 units apart in Z with a 0.5 unit drop in Y —
 * exactly reproducing the old `MODULE_STEP` chaining distance (ADR 0031), so
 * `M1_TRACK` below lands at the same positions it always has.
 */
const STRAIGHT_SOCKETS: Socket[] = [
  { id: "entry", type: "floor", position: { x: 0, y: 0, z: 3 }, yaw: Math.PI },
  { id: "exit", type: "floor", position: { x: 0, y: -0.5, z: -3 }, yaw: 0 },
];

/** A generic, roomy-enough Footprint shared by every current (straight, ~6-unit) Module. */
const STRAIGHT_FOOTPRINT: Footprint = {
  bounds: box({ x: 0, y: -0.5, z: 0 }, { x: 4, y: 2, z: 3 }),
  clearance: 0.5,
};

/**
 * The M1 playground's five stops plus its end sandbox, ported from
 * `playground.ts`'s hand-authored world-space geometry (ticket 06's Spinner
 * tuning, ticket 07's feel-tuning) into reusable Modules. Same beats, same
 * Spinner/Prop/Checkpoint tuning values, re-centered per-Module — not
 * byte-identical world geometry (M1's hand-tuned platform widths/gaps varied
 * per-stop, which a shared Footprint deliberately no longer allows), but the
 * same declining run of platforms and bridges with identical obstacle feel.
 */
export const M1_MODULES: Record<string, Module> = {
  start: {
    id: "start",
    statics: [
      box({ x: 0, y: -0.5, z: 0 }, { x: 4, y: 0.5, z: 4 }),
      box({ x: -3.2, y: 0.5, z: 0 }, { x: 0.4, y: 1.5, z: 3 }), // wall
    ],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  bridge: {
    id: "bridge",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  "checkpoint-spinner": {
    id: "checkpoint-spinner",
    statics: [box({ x: 0, y: -0.1, z: 0 }, { x: 3, y: 0.5, z: 4 })],
    checkpoint: {
      respawn: { x: 0, y: 1.35, z: 0 },
      trigger: { center: { x: 0, y: 1.35, z: 0 }, halfExtents: { x: 2.5, y: 2, z: 3.5 } },
    },
    spinners: [{ center: { x: 0, y: 0.95, z: 3 }, armLength: 2.5, halfHeight: 0.4, armRadius: 0.35, angularSpeed: 6.5 }],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  "bridge-2": {
    id: "bridge-2",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  "checkpoint-end-props": {
    id: "checkpoint-end-props",
    statics: [box({ x: 0, y: -0.6, z: 0 }, { x: 4, y: 0.5, z: 4.5 })],
    checkpoint: {
      respawn: { x: 0, y: 0.85, z: 0 },
      trigger: { center: { x: 0, y: 0.85, z: 0 }, halfExtents: { x: 3.5, y: 2, z: 4 } },
    },
    props: [
      { shape: { kind: "box", halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }, center: { x: -1.5, y: 0.3, z: 1 } },
      { shape: { kind: "ball", radius: 0.4 }, center: { x: 1.5, y: 0.3, z: 1 } },
      { shape: { kind: "box", halfExtents: { x: 0.35, y: 0.35, z: 0.35 } }, center: { x: 0, y: 0.25, z: -1.5 } },
    ],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  sandbox: {
    id: "sandbox",
    statics: [box({ x: 0, y: -0.1, z: 0 }, { x: 15, y: 0.5, z: 15 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  /**
   * Mud: the first Surface (M3.6 ticket 01) — deliberately identical geometry
   * to `bridge` above. The property is the deliverable, the look is not
   * (ticket 01's own acceptance criterion): nothing here should tip a player
   * off by sight, only by how much slower they walk across it.
   */
  mud: {
    id: "mud",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
    surface: "mud",
  },
  /**
   * Ice: the second Surface (M3.6 ticket 06) — same deliberately-identical-
   * geometry-to-`bridge` treatment as `mud` above, and the same reasoning:
   * the Surface is the deliverable, not the look.
   */
  ice: {
    id: "ice",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
    surface: "ice",
  },
  /**
   * Speed pad: the first Epoch-latched effect (M3.7 ticket 01) — same
   * deliberately-identical-geometry-to-`bridge` treatment as `mud`/`ice`: the
   * pad's `trigger` covers its floor's own footprint, invisible to a player
   * looking at it.
   */
  "speed-pad": {
    id: "speed-pad",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    speedPads: [{ trigger: box({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 1, z: 2 }), capMultiplier: 2 }],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  /** Slow pad: the same mechanism as `speed-pad`, cap lowered instead of raised (M3.7 ticket 01). */
  "slow-pad": {
    id: "slow-pad",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    speedPads: [{ trigger: box({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 1, z: 2 }), capMultiplier: 0.3 }],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  /**
   * Bounce: a Surface, not a trigger (M3.7 ticket 02) — same deliberately-
   * identical-geometry-to-`bridge` treatment as mud/ice/the pads: nothing
   * here tips a player off by sight, only what happens the instant they land.
   */
  bounce: {
    id: "bounce",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
    surface: "bounce",
  },
  /**
   * Launch pad: the second Epoch-latched trigger (M3.7 ticket 02) — a fixed,
   * precomputed launch vector (Quake's jump-pad model), authored in the
   * Module's own local space and rotated (never translated) into world space
   * by `resolveTrack`. Points along this Module's own forward direction
   * (`STRAIGHT_SOCKETS`' exit faces local -Z) with a large vertical
   * component — comfortably clearing a multi-Module gap.
   */
  "launch-pad": {
    id: "launch-pad",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    launchPads: [{ trigger: box({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 1, z: 2 }), velocity: { x: 0, y: 16, z: -6 } }],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
};

/** The M1 playground, reassembled through the Module/Track system (ticket 01, re-chained via Sockets in round 2). */
export const M1_TRACK: Track = chainTrack(
  ["start", "bridge", "checkpoint-spinner", "bridge-2", "checkpoint-end-props", "sandbox"],
  M1_MODULES,
  { x: 0, y: 0, z: 10 },
);

/**
 * Every Module currently known to the shared package — what the Match server
 * resolves a fetched Track against (ADR 0028). Grows as more Modules are
 * authored; today it's exactly M1's set.
 */
export const MODULE_LIBRARY: Record<string, Module> = M1_MODULES;
