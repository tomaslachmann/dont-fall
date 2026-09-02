import { isMultipleOf90, rotateBoxYaw90, type Box } from "../math/box.js";
import { addVec3, rotateYaw, subVec3, type Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";
import { findSocket, type Module } from "./Module.js";

/**
 * One placed instance of a Module in a Track (CONTEXT.md: Segment). `rotation`
 * (radians, world yaw) must be a multiple of 90° (ADR 0031's amendment) —
 * `RapierSimulation`'s static colliders don't rotate, so anything else would
 * desync the visual/logical placement from what actually collides.
 */
export interface Segment {
  moduleId: string;
  position: Vec3;
  rotation: number;
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

/**
 * Places `moduleId` right after `prev` by aligning `nextModule`'s `entrySocketId`
 * Socket against `prevModule`'s `exitSocketId` Socket (ADR 0031) — the two
 * Sockets end up at the same world position, facing each other (180° apart).
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

  const exitWorldPos = addVec3(prev.position, rotateYaw(exit.position, prev.rotation));
  const exitWorldYaw = prev.rotation + exit.yaw;

  const nextYaw = exitWorldYaw + Math.PI - entry.yaw;
  const nextPos = subVec3(exitWorldPos, rotateYaw(entry.position, nextYaw));

  if (!isMultipleOf90(nextYaw)) {
    throw new Error(
      `placeAfter: chaining "${prevModule.id}" -> "${moduleId}" would land at a ${nextYaw} rad ` +
        `world rotation, not a multiple of 90° (ADR 0031) — check the Modules' Socket yaws`,
    );
  }
  return { moduleId, position: nextPos, rotation: nextYaw };
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
): { statics: Box[]; props: PropConfig[]; spinners: SpinnerConfig[]; checkpoints: Checkpoint[] } => {
  const statics: Box[] = [];
  const props: PropConfig[] = [];
  const spinners: SpinnerConfig[] = [];
  const checkpoints: Checkpoint[] = [];

  for (const segment of track) {
    const module = modules[segment.moduleId];
    if (!module) throw new Error(`Track references unknown Module "${segment.moduleId}"`);

    const placeBox = (box: Box): Box => {
      const rotated = rotateBoxYaw90(box, segment.rotation);
      return { center: addVec3(rotated.center, segment.position), halfExtents: rotated.halfExtents };
    };
    const placePoint = (point: Vec3): Vec3 => addVec3(rotateYaw(point, segment.rotation), segment.position);

    for (const box of module.statics) statics.push(placeBox(box));

    for (const prop of module.props ?? []) {
      props.push({
        ...prop,
        center: placePoint(prop.center),
        shape: prop.shape.kind === "box" ? { kind: "box", halfExtents: placeBox({ center: { x: 0, y: 0, z: 0 }, halfExtents: prop.shape.halfExtents }).halfExtents } : prop.shape,
      });
    }

    for (const spinner of module.spinners ?? []) {
      // The collider's own local dimensions (armLength/armRadius) never
      // change — a Spinner's live rotation each tick already carries any
      // base placement offset via `initialAngle` (`spinnerAngleAt`), so the
      // Module's placement rotation folds in there, not into the shape.
      spinners.push({ ...spinner, center: placePoint(spinner.center), initialAngle: (spinner.initialAngle ?? 0) + segment.rotation });
    }

    if (module.checkpoint) {
      checkpoints.push({
        respawn: placePoint(module.checkpoint.respawn),
        volume: placeBox(module.checkpoint.volume),
      });
    }
  }

  return { statics, props, spinners, checkpoints };
};
