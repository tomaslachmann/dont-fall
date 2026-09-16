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
 * The M1 playground's stops plus its end sandbox, ported from
 * `playground.ts`'s hand-authored world-space geometry (ticket 06's Spinner
 * tuning, ticket 07's feel-tuning) into reusable Modules. Same beats, same
 * Spinner/Prop/Checkpoint tuning values, re-centered per-Module — not
 * byte-identical world geometry (M1's hand-tuned platform widths/gaps varied
 * per-stop, which a shared Footprint deliberately no longer allows), but the
 * same declining run of platforms with identical obstacle feel.
 *
 * Shrinking toward assets (ADR 0073): the plain connectors (`bridge`,
 * `bridge-2`), the pad Modules (`bounce`, `launch-pad` — superseded by the
 * Segment bounce attachment and asset Springs), and the Survival `arena`
 * are deleted outright, not retired — Tracks stored before the deletion
 * that place them now fail as unknown-Module, the same as any removed id.
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
  /**
   * M1's end sandbox — and, since M4 ticket 02, where a run on the seeded
   * Track actually ends. The Finish Zone had to go on a Module the already-
   * published Revisions use, not a new one appended to the Track: a Revision
   * is immutable (ADR 0032), so a Track already stored as `Segment[]` can
   * only become raceable if a Module it already places gains the Zone.
   *
   * Deliberately a modest region just past the entry rather than the whole
   * 30x30 deck: stepping onto the sandbox at all shouldn't Qualify you, you
   * should have to cross it.
   */
  sandbox: {
    id: "sandbox",
    statics: [box({ x: 0, y: -0.1, z: 0 }, { x: 15, y: 0.5, z: 15 })],
    finishZone: {
      trigger: { center: { x: 0, y: 1.4, z: -6 }, halfExtents: { x: 4, y: 2, z: 2 } },
    },
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  /**
   * A dedicated finish piece for a Track author to place on a Draft (M4
   * ticket 02) — an ordinary straight floor whose only distinguishing
   * feature is the Finish Zone spanning it, so a builder can end a Track
   * anywhere without also inheriting the sandbox's 30x30 deck.
   */
  finish: {
    id: "finish",
    statics: [box({ x: 0, y: -0.5, z: 0 }, { x: 4, y: 0.5, z: 4 })],
    finishZone: {
      trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 4, y: 2, z: 2 } },
    },
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  /**
   * Mud: the first Surface (M3.6 ticket 01) — a plain 2×4 deck. The property
   * is the deliverable, the look is not (ticket 01's own acceptance
   * criterion): nothing here should tip a player off by sight, only by how
   * much slower they walk across it.
   */
  /**
   * Retired by ADR 0067 — kept with its Surface so Tracks stored before the
   * retirement drag exactly where they always did. New mud attaches to the
   * Segment instead; hidden from the builder palette by
   * `DEPRECATED_MODULE_IDS`; never place this in a new Track.
   */
  mud: {
    id: "mud",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
    surface: "mud",
  },
  /**
   * Retired by ADR 0066 — kept with its Surface so Tracks stored before the
   * retirement skate exactly where they always did (unlike the pads below,
   * whose behaviour is gone, ice keeps working). New ice is attached to the
   * Segment instead; hidden from the builder palette by
   * `DEPRECATED_MODULE_IDS`; never place this in a new Track.
   */
  ice: {
    id: "ice",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
    surface: "ice",
  },
  /**
   * Retired by ADR 0064 — kept as a geometry-only stub so Tracks stored
   * before the retirement still load (their pads warn via
   * `resolveTrack`'s `warnings` instead of firing). What the statics always
   * were: an ordinary 2×4 deck. Hidden from the builder palette by
   * `DEPRECATED_MODULE_IDS`; never place these in a new Track.
   */
  "speed-pad": {
    id: "speed-pad",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  /** Retired by ADR 0064 — same geometry-only stub treatment as `speed-pad` above. */
  "slow-pad": {
    id: "slow-pad",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
  /** Retired by ADR 0075 — same geometry-only stub treatment as `speed-pad` above. The field moved onto the fan asset. */
  updraft: {
    id: "updraft",
    statics: [box({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0.5, z: 2 })],
    sockets: STRAIGHT_SOCKETS,
    footprint: STRAIGHT_FOOTPRINT,
  },
};

/**
 * The M1 playground, reassembled through the Module/Track system (ticket 01,
 * re-chained via Sockets in round 2). Four stops since ADR 0073 deleted the
 * plain `bridge` connectors — every beat that matters (the Spinner, the
 * Props, both Checkpoints, the sandbox finish) is still here.
 */
export const M1_TRACK: Track = chainTrack(
  ["start", "checkpoint-spinner", "checkpoint-end-props", "sandbox"],
  M1_MODULES,
  { x: 0, y: 0, z: 10 },
);

/**
 * Every Module currently known to the shared package — what the Match server
 * resolves a fetched Track against (ADR 0028). Grows as more Modules are
 * authored; today it's exactly M1's set.
 */
export const MODULE_LIBRARY: Record<string, Module> = M1_MODULES;
