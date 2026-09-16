import type { OrientedBox } from "../math/box.js";
import { conjugateQuat, IDENTITY_QUAT } from "../math/quat.js";
import { rotateVec3ByQuat, subVec3, type Vec3 } from "../math/vec3.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS } from "../tuning.js";
import type { PlacedGate } from "./Gate.js";
import type { Module } from "./Module.js";
import { hasMotion } from "./Motion.js";
import type { Segment, StaticTrimesh, Track } from "./Track.js";

/**
 * A hoop or an arch switched on as a Checkpoint (CONTEXT.md: Checkpoint, Gate;
 * ADR 0068). Checkpoints count forward by `order`; `respawn`, when the author
 * chose one, is the floor spot a Respawn stands on, in the gate Segment's own
 * frame — absent means the floor just in front of the gate
 * ({@link respawnProbeOrigins}).
 */
export interface SegmentCheckpoint {
  order: number;
  respawn?: Vec3;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Why `value` is not a storable Segment Checkpoint, or `undefined` when it is. */
export const invalidCheckpointReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "checkpoint must be an object";
  const { order, respawn, ...rest } = value as { order?: unknown; respawn?: unknown };
  const extra = Object.keys(rest);
  if (extra.length > 0) return `checkpoint has unknown field(s): ${extra.join(", ")}`;
  if (!Number.isInteger(order) || (order as number) < 1) return `checkpoint.order must be a whole number from 1, got ${JSON.stringify(order)}`;
  if (respawn !== undefined) {
    const p = respawn as { x?: unknown; y?: unknown; z?: unknown } | null;
    if (typeof p !== "object" || p === null || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
      return "checkpoint.respawn must be a point with finite x/y/z when present";
    }
  }
  return undefined;
};

/** Why `value` is not a storable Start mark, or `undefined` when it is — exactly `true`, omitted when unset. */
export const invalidStartReason = (value: unknown): string | undefined =>
  value === true ? undefined : "start must be true when present — omit it on every other Segment";

/** The Start Segment's index, or `undefined` for a Track without one (it starts on its first Segment). */
export const startSegmentIndex = (track: Track): number | undefined => {
  const index = track.findIndex((segment) => segment.start === true);
  return index === -1 ? undefined : index;
};

/**
 * The first course rule a Track breaks (ADR 0068), named by Segment index, or
 * `undefined`: one Start at most; no Motion on a Start, a Checkpoint gate or a
 * finish sign; a Checkpoint only on a Gate that can be one, each number once.
 * Unknown Modules are someone else's error and skipped here.
 */
export const invalidTrackCourseReason = (track: Track, modules: Record<string, Module>): string | undefined => {
  const starts = track.flatMap((segment, index) => (segment.start === true ? [index] : []));
  if (starts.length > 1) return `track has ${starts.length} Starts (Segments ${starts.join(", ")}) — one at most`;
  const orders = new Map<number, number>();
  for (const [index, segment] of track.entries()) {
    const module = modules[segment.moduleId];
    const moving = hasMotion(segment.motion);
    if (segment.start === true && moving) return `track[${index}] is the Start and moves — a Start stays still`;
    if (module?.gate?.role === "finish" && moving) return `track[${index}] is a finish sign and moves — finishes stay still`;
    if (segment.checkpoint === undefined) continue;
    if (!module) continue;
    if (module.gate?.role !== "checkpoint") return `track[${index}].checkpoint is on "${segment.moduleId}", which is not a hoop or an arch`;
    if (moving) return `track[${index}] is a Checkpoint and moves — Checkpoints stay still`;
    const other = orders.get(segment.checkpoint.order);
    if (other !== undefined) return `track[${index}] and track[${other}] are both Checkpoint ${segment.checkpoint.order}`;
    orders.set(segment.checkpoint.order, index);
  }
  return undefined;
};

/** How far below a gate the floor probe looks before calling it a drop. */
export const RESPAWN_PROBE_DEPTH = 50;
/** A Respawn's capsule centre above the floor it stands on — clear of it, like a spawn. */
export const RESPAWN_ABOVE_FLOOR = CAPSULE_BOTTOM_OFFSET + 0.1;

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

/** Distance along `dir` from `origin` to `box`, or `undefined` for a miss. */
const rayHitsBox = (origin: Vec3, dir: Vec3, box: OrientedBox, maxDistance: number): number | undefined => {
  const inverse = conjugateQuat(box.rotation ?? IDENTITY_QUAT);
  const o = rotateVec3ByQuat(subVec3(origin, box.center), inverse);
  const d = rotateVec3ByQuat(dir, inverse);
  let near = 0;
  let far = maxDistance;
  for (const axis of ["x", "y", "z"] as const) {
    const half = box.halfExtents[axis];
    if (Math.abs(d[axis]) < 1e-12) {
      if (o[axis] < -half || o[axis] > half) return undefined;
      continue;
    }
    let t0 = (-half - o[axis]) / d[axis];
    let t1 = (half - o[axis]) / d[axis];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return undefined;
  }
  return near;
};

/** Distance straight down from `origin` to the triangle, or `undefined` (Möller–Trumbore, both faces). */
const rayDownHitsTriangle = (origin: Vec3, a: Vec3, b: Vec3, c: Vec3): number | undefined => {
  const e1 = subVec3(b, a);
  const e2 = subVec3(c, a);
  const p = { x: DOWN.y * e2.z - DOWN.z * e2.y, y: DOWN.z * e2.x - DOWN.x * e2.z, z: DOWN.x * e2.y - DOWN.y * e2.x }; // DOWN × e2
  const det = e1.x * p.x + e1.y * p.y + e1.z * p.z;
  if (Math.abs(det) < 1e-12) return undefined;
  const s = subVec3(origin, a);
  const u = (s.x * p.x + s.y * p.y + s.z * p.z) / det;
  if (u < 0 || u > 1) return undefined;
  const q = { x: s.y * e1.z - s.z * e1.y, y: s.z * e1.x - s.x * e1.z, z: s.x * e1.y - s.y * e1.x };
  const v = (DOWN.x * q.x + DOWN.y * q.y + DOWN.z * q.z) / det;
  if (v < 0 || u + v > 1) return undefined;
  const t = (e2.x * q.x + e2.y * q.y + e2.z * q.z) / det;
  return t >= 0 ? t : undefined;
};

/**
 * The first still floor straight below `from` within {@link RESPAWN_PROBE_DEPTH}
 * — boxes and asset trimeshes alike — as the point on it, or `undefined` over
 * a drop. Pure geometry, so every side resolving the Track finds the same spot.
 */
export const floorBelow = (from: Vec3, boxes: readonly OrientedBox[], trimeshes: readonly StaticTrimesh[]): Vec3 | undefined => {
  let nearest = RESPAWN_PROBE_DEPTH;
  let hit = false;
  for (const box of boxes) {
    const t = rayHitsBox(from, DOWN, box, nearest);
    if (t !== undefined && t <= nearest) {
      nearest = t;
      hit = true;
    }
  }
  for (const mesh of trimeshes) {
    let [minX, maxX, minZ, maxZ, maxY] = [Infinity, -Infinity, Infinity, -Infinity, -Infinity];
    for (const v of mesh.vertices) {
      [minX, maxX, minZ, maxZ, maxY] = [Math.min(minX, v.x), Math.max(maxX, v.x), Math.min(minZ, v.z), Math.max(maxZ, v.z), Math.max(maxY, v.y)];
    }
    if (from.x < minX || from.x > maxX || from.z < minZ || from.z > maxZ || maxY < from.y - nearest) continue;
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const t = rayDownHitsTriangle(from, mesh.vertices[mesh.indices[i]!]!, mesh.vertices[mesh.indices[i + 1]!]!, mesh.vertices[mesh.indices[i + 2]!]!);
      if (t !== undefined && t <= nearest) {
        nearest = t;
        hit = true;
      }
    }
  }
  return hit ? { x: from.x, y: from.y - nearest, z: from.z } : undefined;
};

/** How far past a gate's own depth its default Respawn stands — clear of its posts and stand by a capsule and a step. */
export const RESPAWN_GATE_CLEARANCE = CAPSULE_RADIUS + 0.6;

const UNIT: Record<"x" | "y" | "z", Vec3> = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };

/**
 * Where a gate Checkpoint's default Respawn is looked for (ADR 0068), in
 * order: just in front of the gate — on the side a runner arrives from,
 * toward `arrivingFrom` (the previous Checkpoint, or the spawn) — then just
 * behind it. Never straight under the opening: a hoop stands on its own post,
 * and a Respawn there lands on it or inside it. "Just" is past the gate's
 * whole footprint along its through-direction, plus
 * {@link RESPAWN_GATE_CLEARANCE}, at the opening's height so the probe falls
 * onto whatever deck is there.
 */
export const respawnProbeOrigins = (gate: PlacedGate, footprint: OrientedBox, arrivingFrom: Vec3): Vec3[] => {
  const across = Math.hypot(gate.n.x, gate.n.z);
  if (across < 1e-6) return [gate.center]; // a gate lying flat: under it is the only answer
  const dir = { x: gate.n.x / across, z: gate.n.z / across };
  const along = (p: { x: number; z: number }): number => p.x * dir.x + p.z * dir.z;
  const rotation = footprint.rotation ?? IDENTITY_QUAT;
  const depth = (["x", "y", "z"] as const).reduce((sum, axis) => sum + Math.abs(along(rotateVec3ByQuat(UNIT[axis], rotation))) * footprint.halfExtents[axis], 0);
  const middle = along(footprint.center) - along(gate.center);
  const front = along(arrivingFrom) - along(gate.center) >= 0 ? 1 : -1;
  const at = (side: 1 | -1): Vec3 => {
    const distance = middle + side * (depth + RESPAWN_GATE_CLEARANCE);
    return { x: gate.center.x + dir.x * distance, y: gate.center.y, z: gate.center.z + dir.z * distance };
  };
  return [at(front), at(front === 1 ? -1 : 1)];
};

/** Whether a Segment is a Checkpoint gate a Track counts (switched on, on a Gate that can be one). */
export const isCheckpointGate = (segment: Segment, modules: Record<string, Module>): boolean =>
  segment.checkpoint !== undefined && modules[segment.moduleId]?.gate?.role === "checkpoint";
