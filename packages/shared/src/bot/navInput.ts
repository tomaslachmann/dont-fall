import type { OrientedBox } from "../math/box.js";
import { IDENTITY_QUAT } from "../math/quat.js";
import { rotateVec3ByQuat } from "../math/vec3.js";
import type { ResolvedTrack, StaticTrimesh } from "../track/resolveTrack.js";
import { DEFAULT_SURFACE, surfaceConfig, type SurfaceId } from "../track/Surface.js";

/**
 * What of a resolved Track a Bot's navmesh is built from (M17 ticket 05):
 * only what stays where it was placed, and the pads and Volumes a link may be
 * proven through. It is all the Match server posts to its Bot track worker,
 * since cloning the rest (moving Segments' meshes above all) cost as much as
 * the build it was moved off the loop to save.
 */
export type BotStillWorld = Pick<ResolvedTrack, "statics" | "staticSurfaces" | "staticConveyors" | "staticTrimeshes" | "launchPads" | "volumes"> & {
  /**
   * Every gated floor at its rest pose (M17 ticket 07): a trap door's leaves
   * and every fragile block, which the simulation carries as bodies (they
   * can be switched off) and so are in none of the above. Rasterised
   * walkable, flagged `GATED_FLAG` after the build (`markGatedPolys`).
   * Absent: none, as on every Track before the DF traps.
   */
  gatedFloors?: readonly GatedFloor[];
};

/**
 * A gated floor as the navmesh is built over it (M17 ticket 07): a trap
 * door's leaf or a fragile block at its rest pose, in world space, shaped
 * like the still geometry so it crosses to the Bot track worker the same way.
 */
export interface GatedFloor {
  readonly segmentIndex: number;
  readonly boxes: readonly OrientedBox[];
  /** Index-aligned with `boxes`. */
  readonly surfaces: readonly SurfaceId[];
  readonly trimeshes: readonly StaticTrimesh[];
}

/** Flat world-space triangles, the shape Recast reads. */
export interface NavInput {
  positions: Float32Array;
  indices: Uint32Array;
  /**
   * One Recast area id per triangle (M17 ticket 04): which entry of
   * {@link surfaces} the triangle's floor is. A walkable triangle keeps it;
   * `markWalkableTriangles` still decides which triangles are walkable at all.
   */
  areas: Uint8Array;
  /**
   * The Surface each area id stands for, by id. Id 0 is Recast's "not
   * walkable" and is never a Surface, so index 0 is unused. Ordered from the
   * cheapest Surface to the costliest (see {@link navAreaCost}): where two
   * floors meet in one voxel Recast keeps the higher id, so a Bot assumes the
   * harder floor.
   */
  surfaces: readonly SurfaceId[];
}

/**
 * What a metre of a Surface costs a Bot's path search (M17 ticket 04): the
 * time it takes, which is one over the Surface's own top speed (ADR 0094).
 * Mud at its 0.4 costs two and a half metres of plain floor, so a Bot goes
 * round it whenever the way round is shorter than that; ice's milder penalty
 * makes it a small detour's worth. Read from the Surface's tuning, never a
 * number of its own.
 */
export const navAreaCost = (surface: SurfaceId): number => 1 / surfaceConfig(surface).topSpeedMultiplier;

// A box's eight corners by sign, and its twelve triangles wound outward.
const CORNERS: readonly [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const BOX_TRIANGLES: readonly number[] = [
  0, 2, 1, 0, 3, 2, // −z
  4, 5, 6, 4, 6, 7, // +z
  0, 1, 5, 0, 5, 4, // −y
  3, 7, 6, 3, 6, 2, // +y
  0, 4, 7, 0, 7, 3, // −x
  1, 2, 6, 1, 6, 5, // +x
];

/**
 * Everything on a Track that stays where it was placed, as triangles: the
 * box half (`statics`) and the Asset half (`staticTrimeshes`) of what
 * `resolveTrack` gives the simulation, so a Bot plans over exactly what a
 * Character collides with.
 *
 * Left out, deliberately: moving Segments (`movingSegments`), Props and
 * Spinners. A Bot reads those at the Tick it plans for, never off a mesh
 * built once. Trap door leaves and fragile floors, which `movingSegments`
 * also carries, are the exception since M17 ticket 07: they are in at their
 * rest pose (`gatedFloors`), flagged, and switched off on the navmesh as
 * the Round switches them off.
 */
export const trackNavInput = (resolved: BotStillWorld): NavInput => {
  const gated = resolved.gatedFloors ?? [];
  const present = new Set<SurfaceId>([DEFAULT_SURFACE, ...resolved.staticSurfaces, ...resolved.staticTrimeshes.map((mesh) => mesh.surface)]);
  // Cheapest first, ties by name, so the ids do not depend on the Track's order.
  const surfaces = [...present].sort((a, b) => navAreaCost(a) - navAreaCost(b) || a.localeCompare(b));
  const areaOf = new Map(surfaces.map((surface, i) => [surface, i + 1]));
  // A gated floor's Surfaces get area ids of their own, after the still ones
  // (M17 ticket 07): Recast never merges regions across areas, so its
  // polygons stop at the floor's edge and `markGatedPolys` can flag exactly
  // them. The Surface each id stands for is the same, so a Bot reads the
  // same grip and cost there.
  const gatedSurfaces = [...new Set(gated.flatMap((floor) => [...floor.surfaces, ...floor.trimeshes.map((mesh) => mesh.surface)]))].sort(
    (a, b) => navAreaCost(a) - navAreaCost(b) || a.localeCompare(b),
  );
  const gatedAreaOf = new Map(gatedSurfaces.map((surface, i) => [surface, surfaces.length + 1 + i]));
  const positions: number[] = [];
  const indices: number[] = [];
  const areas: number[] = [];
  resolved.statics.forEach((box, i) => {
    pushBox(box, positions, indices);
    const area = areaOf.get(resolved.staticSurfaces[i] ?? DEFAULT_SURFACE)!;
    for (let t = 0; t < BOX_TRIANGLES.length / 3; t += 1) areas.push(area);
  });
  const pushMesh = (mesh: StaticTrimesh, area: number): void => {
    const base = positions.length / 3;
    for (const v of mesh.vertices) positions.push(v.x, v.y, v.z);
    for (const i of mesh.indices) indices.push(base + i);
    for (let t = 0; t < mesh.indices.length / 3; t += 1) areas.push(area);
  };
  for (const mesh of resolved.staticTrimeshes) pushMesh(mesh, areaOf.get(mesh.surface)!);
  // A gated floor is walkable at rest (M17 ticket 07): a Bot routes over a
  // shut trap door and an intact fragile block; `markGatedPolys` flags them.
  for (const floor of gated) {
    floor.boxes.forEach((box, i) => {
      pushBox(box, positions, indices);
      const area = gatedAreaOf.get(floor.surfaces[i] ?? DEFAULT_SURFACE)!;
      for (let t = 0; t < BOX_TRIANGLES.length / 3; t += 1) areas.push(area);
    });
    for (const mesh of floor.trimeshes) pushMesh(mesh, gatedAreaOf.get(mesh.surface)!);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    areas: new Uint8Array(areas),
    surfaces: [DEFAULT_SURFACE, ...surfaces, ...gatedSurfaces],
  };
};

const pushBox = ({ center, halfExtents, rotation }: OrientedBox, positions: number[], indices: number[]): void => {
  const base = positions.length / 3;
  for (const [sx, sy, sz] of CORNERS) {
    const local = { x: sx * halfExtents.x, y: sy * halfExtents.y, z: sz * halfExtents.z };
    const p = rotateVec3ByQuat(local, rotation ?? IDENTITY_QUAT);
    positions.push(center.x + p.x, center.y + p.y, center.z + p.z);
  }
  for (const i of BOX_TRIANGLES) indices.push(base + i);
};
