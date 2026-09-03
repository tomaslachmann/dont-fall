import { orientBox, type Box, type OrientedBox } from "../math/box.js";
import { conjugateQuat, eulerQuat, mulQuat, quatToEuler, yawQuat, type Quat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, subVec3, type Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";
import { findSocket, type Module, type Socket } from "./Module.js";

/**
 * One placed instance of a Module in a Track (CONTEXT.md: Segment).
 * `rotation` (radians, world yaw) is the same field this has always had.
 * `pitch`/`roll` (radians, ADR 0034) are additive and optional, defaulting to
 * 0 — every Revision published before ADR 0034 (including the M1 seed) has
 * neither field and resolves identically to before. Together the three
 * compose a full 3D orientation ({@link segmentOrientation}); no longer
 * restricted to a multiple of 90° (ADR 0031's restriction existed only
 * because the old placement scheme pre-rotated an axis-aligned box by hand
 * instead of giving `RapierSimulation` a real rotated collider).
 *
 * `manuallyPlaced` (ticket 02) is a pure Track-builder authoring concern —
 * `resolveTrack`/`RapierSimulation`/the Match server never read it, a Segment
 * always just has whatever position/orientation it has. It exists so the
 * builder's `rechainFrom` (auto-recompute from the socket chain) can skip a
 * Segment the author has explicitly moved/rotated by hand, rather than
 * silently overwriting it on the next unrelated edit. Lives on `Segment`
 * itself (not a side-table keyed by index) so it naturally survives
 * insert/delete/reorder and undo/redo along with the Segment it describes.
 */
export interface Segment {
  moduleId: string;
  position: Vec3;
  rotation: number;
  pitch?: number;
  roll?: number;
  manuallyPlaced?: boolean;
}

/** A Track: an ordered sequence of Segments (CONTEXT.md). */
export type Track = Segment[];

/**
 * One row of track-service's `GET /tracks` listing (ticket 09/ADR 0032) — a
 * Track's id/name/author/createdAt without its full Segment data. Shared
 * between track-service (the producer) and the Track builder (the consumer)
 * so the two never silently drift apart (code review, ticket 09 — this used
 * to be declared separately in each).
 */
export interface TrackListing {
  id: string;
  name: string | null;
  authorId: string;
  createdAt: number;
}

/** A Segment's full 3D orientation as one quaternion (ADR 0034) — composes its yaw/pitch/roll fields. */
export const segmentOrientation = (segment: Pick<Segment, "rotation" | "pitch" | "roll">): Quat =>
  eulerQuat(segment.rotation, segment.pitch ?? 0, segment.roll ?? 0);

/** A Socket's full local orientation as one quaternion (ADR 0034) — composes its yaw/pitch/roll fields. */
const socketOrientation = (socket: Pick<Socket, "yaw" | "pitch" | "roll">): Quat =>
  eulerQuat(socket.yaw, socket.pitch ?? 0, socket.roll ?? 0);

/** Below the noise floor of `eulerQuat`/`quatToEuler`'s own float error — treated as exactly 0 (an untilted Segment). */
const PITCH_ROLL_EPSILON = 1e-9;

/**
 * Places `moduleId` right after `prev` by aligning `nextModule`'s `entrySocketId`
 * Socket against `prevModule`'s `exitSocketId` Socket (ADR 0031) — the two
 * Sockets end up at the same world position, facing each other (180° apart).
 *
 * Generalized to a full 3D orientation (ADR 0034):
 * 1. `exitWorldOrientation` — the exit Socket's orientation composed into
 *    world space: `prev`'s own orientation, then the Socket's local one.
 * 2. The entry Socket must face the exact opposite way, so the next
 *    Segment's orientation is `exitWorldOrientation`, turned 180° around its
 *    own local up, with the entry Socket's local orientation un-composed
 *    back out (so the entry Socket itself — not the Segment's own origin —
 *    is what lands on the exit Socket).
 *
 * This is the direct quaternion generalization of the old
 * `nextYaw = exitWorldYaw + π - entry.yaw` arithmetic — for yaw-only Sockets
 * (every Socket authored before ADR 0034) the two formulas agree exactly,
 * which is what keeps `M1_TRACK` chaining to the identical positions it
 * always has (pinned by this package's `Track.test.ts`).
 */
export const placeAfter = (
  prev: Segment,
  prevModule: Module,
  moduleId: string,
  nextModule: Module,
  exitSocketId = "exit",
  entrySocketId = "entry",
): Segment => {
  const exit = findSocket(prevModule, exitSocketId);
  const entry = findSocket(nextModule, entrySocketId);

  const prevOrientation = segmentOrientation(prev);
  const exitLocalOrientation = socketOrientation(exit);
  const exitWorldOrientation = mulQuat(prevOrientation, exitLocalOrientation);
  const exitWorldPos = addVec3(prev.position, rotateVec3ByQuat(exit.position, prevOrientation));

  const entryLocalOrientation = socketOrientation(entry);
  const nextOrientation = mulQuat(mulQuat(exitWorldOrientation, yawQuat(Math.PI)), conjugateQuat(entryLocalOrientation));
  const nextPos = subVec3(exitWorldPos, rotateVec3ByQuat(entry.position, nextOrientation));

  const { yaw, pitch, roll } = quatToEuler(nextOrientation);
  return {
    moduleId,
    position: nextPos,
    rotation: yaw,
    ...(Math.abs(pitch) > PITCH_ROLL_EPSILON ? { pitch } : {}),
    ...(Math.abs(roll) > PITCH_ROLL_EPSILON ? { roll } : {}),
  };
};

/**
 * Places `moduleIds` end-to-end from `start`/`startRotation`, each one
 * aligned via `placeAfter`. This is the "no compatibility metadata" chaining
 * ADR 0031's Sockets exist to enable (every current Socket is type
 * `"floor"`, so any Module can follow any other) — used by both a random
 * assembler and as a starting layout a builder can then edit further.
 */
export const chainTrack = (
  moduleIds: string[],
  modules: Record<string, Module>,
  start: Vec3 = { x: 0, y: 0, z: 0 },
  startRotation = 0,
): Track => {
  const track: Track = [];
  let prevModuleId: string | undefined;

  for (const moduleId of moduleIds) {
    const module = modules[moduleId];
    if (!module) throw new Error(`chainTrack: unknown Module "${moduleId}"`);

    if (prevModuleId === undefined) {
      track.push({ moduleId, position: start, rotation: startRotation });
    } else {
      const prevModule = modules[prevModuleId]!;
      const prevSegment = track[track.length - 1]!;
      track.push(placeAfter(prevSegment, prevModule, moduleId, module));
    }
    prevModuleId = moduleId;
  }
  return track;
};

/** Flattens a Track into the world-space geometry `RapierSimulation`/the scene consume. */
export const resolveTrack = (
  modules: Record<string, Module>,
  track: Track,
): { statics: OrientedBox[]; props: PropConfig[]; spinners: SpinnerConfig[]; checkpoints: Checkpoint[] } => {
  const statics: OrientedBox[] = [];
  const props: PropConfig[] = [];
  const spinners: SpinnerConfig[] = [];
  const checkpoints: Checkpoint[] = [];

  for (const segment of track) {
    const module = modules[segment.moduleId];
    if (!module) throw new Error(`Track references unknown Module "${segment.moduleId}"`);

    const orientation = segmentOrientation(segment);
    const placeBox = (box: Box): OrientedBox => orientBox(box, segment.position, orientation);
    const placePoint = (point: Vec3): Vec3 => addVec3(rotateVec3ByQuat(point, orientation), segment.position);

    for (const box of module.statics) statics.push(placeBox(box));

    // Props don't yet carry an initial rotation of their own (`PropConfig`
    // has no orientation field — every Prop always spawns axis-aligned and
    // only tumbles from live simulation afterward). A tilted Segment's Prop
    // is positioned correctly but not yet shape-tilted — a known limitation
    // to lift once Props gain a real spawn orientation, not attempted here
    // (a separate feature, not this ticket's static-collider scope).
    //
    // Code review, ticket 01: this is a real (if currently latent) step back
    // for an oblong Prop specifically at a 90°/270°-rotated Segment — the old
    // rotateBoxYaw90-based placement swapped such a Prop's halfExtents to
    // stay visually correct there, which this no longer does for ANY angle.
    // Every Prop `modules.ts` authors today is a cube (rotation-invariant in
    // shape), so nothing currently observable regresses; flagging so a future
    // oblong Prop author doesn't quietly inherit a mismatched collider.
    for (const prop of module.props ?? []) {
      props.push({ ...prop, center: placePoint(prop.center) });
    }

    for (const spinner of module.spinners ?? []) {
      // A Spinner always spins around world Y (`Spinner.ts` hardcodes this) —
      // only its position and its yaw-driven `initialAngle` (which way it
      // starts facing) follow the Segment's orientation; pitch/roll don't
      // tilt its spin axis. A known limitation, not attempted here.
      spinners.push({ ...spinner, center: placePoint(spinner.center), initialAngle: (spinner.initialAngle ?? 0) + segment.rotation });
    }

    if (module.checkpoint) {
      checkpoints.push({
        respawn: placePoint(module.checkpoint.respawn),
        // Rotated exactly like a static Box (ADR 0034 code review) —
        // `pointInOrientedBox` un-rotates the query point at containment-check
        // time, so this is correct at any angle, not an axis-aligned
        // approximation (the old rotateBoxYaw90-based placement only handled
        // 90°/270° correctly, by swapping halfExtents).
        volume: placeBox(module.checkpoint.volume),
      });
    }
  }

  return { statics, props, spinners, checkpoints };
};
