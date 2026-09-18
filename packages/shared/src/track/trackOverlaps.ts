import RAPIER from "@dimforge/rapier3d-compat";
import { mulQuat, type Quat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, scaleVec3, type Vec3 } from "../math/vec3.js";
import { movingSegmentPose } from "../simulation/MovingSegment.js";
import type { SolidShape } from "./asset.js";
import type { Module } from "./Module.js";
import { scaleSolidShape, segmentOrientation, segmentScale, type Track } from "./Track.js";

/**
 * Where two placed Assets sit inside each other (the user, 2026-09-18: an
 * arena whose pieces overlap "glitchuje v renderu a není to hezké"): the
 * decks' coplanar tops fight over every pixel, and a bar swept through a
 * piston clips through it. The code-authored Tracks are held to none.
 *
 * Every Asset is measured as its authored solid parts (ADR 0065), the shapes
 * it collides as. Two Segments overlap when any part of one is sunk more than
 * `tolerance` into any part of the other. Touching faces (a deck butted
 * against the next, a flag stood on a deck) are no overlap, and neither is
 * the fit: a solid box is fitted a few centimetres proud of its mesh (a
 * `platform_4x2x1`'s runs 4 cm past each end), so the default tolerance, 10
 * cm, is the fit's and not the placement's. The overlaps this was written
 * for ran from 30 cm to 3 m.
 *
 * A Segment with a Motion is posed through `samples` instants of it, so a bar
 * that only clips a piston on its way round is caught too; a still pair is
 * measured once.
 *
 * Not exported from the package index: it builds Rapier shapes and belongs to
 * the suites, as `walkTrack.ts` does.
 */
export interface SegmentOverlap {
  /** The two Segments, by index, lower first. */
  a: number;
  b: number;
  /** The deepest either sinks into the other, in metres. */
  depth: number;
  /** The Tick it was deepest at (0 for two still Segments). */
  tick: number;
}

export interface OverlapOptions {
  tolerance?: number;
  /** Instants a moving Segment is posed at, `step` Ticks apart. */
  samples?: number;
  step?: number;
}

interface Part {
  shape: RAPIER.Shape;
  local: { min: Vec3; max: Vec3 };
  position: Vec3;
  rotation: Quat;
}

const shapeOf = (shape: SolidShape): RAPIER.Shape => {
  switch (shape.type) {
    case "ball":
      return new RAPIER.Ball(shape.radius);
    case "capsule":
      return new RAPIER.Capsule(shape.halfHeight, shape.radius);
    case "cylinder":
      return new RAPIER.Cylinder(shape.halfHeight, shape.radius);
    case "box":
      return new RAPIER.Cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    case "hull":
      return new RAPIER.ConvexPolyhedron(new Float32Array(shape.points.flatMap((p) => [p.x, p.y, p.z])), null);
  }
};

const localBounds = (shape: SolidShape): { min: Vec3; max: Vec3 } => {
  switch (shape.type) {
    case "ball":
      return { min: { x: -shape.radius, y: -shape.radius, z: -shape.radius }, max: { x: shape.radius, y: shape.radius, z: shape.radius } };
    case "capsule": {
      const h = shape.halfHeight + shape.radius;
      return { min: { x: -shape.radius, y: -h, z: -shape.radius }, max: { x: shape.radius, y: h, z: shape.radius } };
    }
    case "cylinder":
      return {
        min: { x: -shape.radius, y: -shape.halfHeight, z: -shape.radius },
        max: { x: shape.radius, y: shape.halfHeight, z: shape.radius },
      };
    case "box":
      return { min: scaleVec3(shape.halfExtents, -1), max: shape.halfExtents };
    case "hull": {
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      const zs = shape.points.map((p) => p.z);
      return {
        min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
        max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
      };
    }
  }
};

interface Placed {
  position: Vec3;
  rotation: Quat;
}

/** A world-space box around `part` placed at `pose`, for the cheap test before the real one. */
const worldBounds = (part: Part, pose: Placed): { min: Vec3; max: Vec3 } => {
  const rotation = mulQuat(pose.rotation, part.rotation);
  const centre = addVec3(rotateVec3ByQuat(part.position, pose.rotation), pose.position);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const x of [part.local.min.x, part.local.max.x]) {
    for (const y of [part.local.min.y, part.local.max.y]) {
      for (const z of [part.local.min.z, part.local.max.z]) {
        const p = addVec3(rotateVec3ByQuat({ x, y, z }, rotation), centre);
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
        max.z = Math.max(max.z, p.z);
      }
    }
  }
  return { min, max };
};

const boundsMeet = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }): boolean =>
  a.min.x <= b.max.x && b.min.x <= a.max.x && a.min.y <= b.max.y && b.min.y <= a.max.y && a.min.z <= b.max.z && b.min.z <= a.max.z;

/** How far `a` placed at `poseA` is sunk into `b` at `poseB` — 0 when they only touch or stand apart. */
const sunk = (a: Part, poseA: Placed, b: Part, poseB: Placed): number => {
  const rotationA = mulQuat(poseA.rotation, a.rotation);
  const rotationB = mulQuat(poseB.rotation, b.rotation);
  const contact = a.shape.contactShape(
    addVec3(rotateVec3ByQuat(a.position, poseA.rotation), poseA.position),
    rotationA,
    b.shape,
    addVec3(rotateVec3ByQuat(b.position, poseB.rotation), poseB.position),
    rotationB,
    0,
  );
  return contact === null ? 0 : Math.max(0, -contact.distance);
};

/** Every pair of Segments in `track` that sit inside each other, deepest first. Needs `initPhysics()`. */
export const findOverlaps = (
  library: Record<string, Module>,
  track: Track,
  { tolerance = 0.1, samples = 60, step = 6 }: OverlapOptions = {},
): SegmentOverlap[] => {
  const pieces = track.map((segment) => {
    const module = library[segment.moduleId];
    const scale = segmentScale(segment);
    const parts: Part[] = (module?.asset?.solid ?? []).map((part) => {
      const shape = scaleSolidShape(part.shape, scale);
      return { shape: shapeOf(shape), local: localBounds(shape), position: scaleVec3(part.position, scale), rotation: part.rotation };
    });
    const orientation = segmentOrientation(segment);
    const poseAt = (tick: number): Placed =>
      segment.motion
        ? movingSegmentPose({ position: segment.position, orientation, motion: segment.motion, scale }, tick)
        : { position: segment.position, rotation: orientation };
    return { parts, moving: segment.motion !== undefined, poseAt };
  });

  // Each piece posed once per instant it can be at, with a box round every
  // part there and one round the whole of its travel, so a pair that never
  // comes near is dropped before any real test.
  const instants = Array.from({ length: samples }, (_, i) => i * step);
  const posed = pieces.map((piece) => {
    const ticks = piece.moving ? instants : [0];
    const poses = ticks.map((tick) => piece.poseAt(tick));
    const bounds = poses.map((pose) => piece.parts.map((part) => worldBounds(part, pose)));
    const all = bounds.flat();
    const reach = {
      min: { x: Math.min(...all.map((b) => b.min.x)), y: Math.min(...all.map((b) => b.min.y)), z: Math.min(...all.map((b) => b.min.z)) },
      max: { x: Math.max(...all.map((b) => b.max.x)), y: Math.max(...all.map((b) => b.max.y)), z: Math.max(...all.map((b) => b.max.z)) },
    };
    return { ...piece, poses, bounds, reach };
  });

  const found: SegmentOverlap[] = [];
  for (let a = 0; a < posed.length; a += 1) {
    for (let b = a + 1; b < posed.length; b += 1) {
      const pa = posed[a]!;
      const pb = posed[b]!;
      if (pa.parts.length === 0 || pb.parts.length === 0 || !boundsMeet(pa.reach, pb.reach)) continue;
      const count = pa.moving || pb.moving ? instants.length : 1;
      let deepest = { depth: 0, tick: 0 };
      for (let k = 0; k < count; k += 1) {
        const ka = pa.moving ? k : 0;
        const kb = pb.moving ? k : 0;
        pa.parts.forEach((partA, i) => {
          const boundsA = pa.bounds[ka]![i]!;
          pb.parts.forEach((partB, j) => {
            if (!boundsMeet(boundsA, pb.bounds[kb]![j]!)) return;
            const depth = sunk(partA, pa.poses[ka]!, partB, pb.poses[kb]!);
            if (depth > deepest.depth) deepest = { depth, tick: instants[k]! };
          });
        });
      }
      if (deepest.depth > tolerance) found.push({ a, b, ...deepest });
    }
  }
  return found.sort((x, y) => y.depth - x.depth);
};
