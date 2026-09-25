import {
  allocCompactHeightfield,
  allocContourSet,
  allocHeightfield,
  allocPolyMesh,
  allocPolyMeshDetail,
  buildCompactHeightfield,
  buildContours,
  buildDistanceField,
  buildPolyMesh,
  buildPolyMeshDetail,
  buildRegions,
  calcGridSize,
  createHeightfield,
  createNavMeshData,
  createRcConfig,
  erodeWalkableArea,
  exportNavMesh,
  filterLowHangingWalkableObstacles,
  filterWalkableLowHeightSpans,
  freeCompactHeightfield,
  freeContourSet,
  freeHeightfield,
  freePolyMesh,
  freePolyMeshDetail,
  importNavMesh,
  init,
  markWalkableTriangles,
  NavMesh,
  NavMeshCreateParams,
  NavMeshQuery,
  QueryFilter,
  rasterizeTriangles,
  Recast,
  type RecastPolyMesh,
  type RecastPolyMeshDetail,
  RecastBuildContext,
  TriangleAreasArray,
  TrianglesArray,
  VerticesArray,
} from "recast-navigation";
import { getBoundingBox, soloNavMeshGeneratorConfigDefaults } from "recast-navigation/generators";
import { pointInOrientedBox, type OrientedBox } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";
import { DEFAULT_SURFACE, type SurfaceId } from "../track/Surface.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import {
  BOT_LINK_COST,
  NAV_AGENT_CLIMB,
  NAV_AGENT_HEIGHT,
  NAV_AGENT_RADIUS,
  NAV_CELL_HEIGHT,
  NAV_CELL_SIZE,
  NAV_WALKABLE_SLOPE_DEGREES,
} from "../tuning/bots.js";
import type { NavLink } from "./links.js";
import { navAreaCost, type GatedFloor, type NavInput } from "./navInput.js";

let ready: Promise<void> | undefined;

/**
 * Loads Recast's WASM once per process (M17, ADR 0129), the way
 * `initPhysics` loads Rapier's. Awaited wherever a Bot can run: the Match
 * server's boot, the local practice session and the suites.
 */
export const initNavigation = (): Promise<void> => (ready ??= init());

/** Recast's generator config, in its own voxel units, from the world-unit tuning. */
export const botNavConfig = () => ({
  cs: NAV_CELL_SIZE,
  ch: NAV_CELL_HEIGHT,
  walkableSlopeAngle: NAV_WALKABLE_SLOPE_DEGREES,
  walkableHeight: Math.ceil(NAV_AGENT_HEIGHT / NAV_CELL_HEIGHT),
  walkableClimb: Math.floor(NAV_AGENT_CLIMB / NAV_CELL_HEIGHT),
  walkableRadius: Math.ceil(NAV_AGENT_RADIUS / NAV_CELL_SIZE),
  maxEdgeLen: Math.round(12 / NAV_CELL_SIZE),
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  // Recast's own defaults. A finer detail mesh only makes a path's heights
  // closer to the floor, which a Bot never reads (its capsule finds the floor
  // itself), and sampling it at 1 m cost 20x the whole build on the base race's
  // ball field (M17 ticket 01). `0` crashes the WASM build.
  detailSampleDist: 6,
  detailSampleMaxError: 1,
});

export interface TrackNav {
  navMesh: NavMesh;
  /** Plans by what each floor costs: its default filter carries every area's {@link navAreaCost}. */
  query: NavMeshQuery;
  /** The Surface each polygon area id stands for ({@link NavInput.surfaces}). */
  surfaces: readonly SurfaceId[];
  /**
   * The links built into this navmesh (M17 ticket 05), by the `userId` Detour
   * gives each off-mesh connection: a corner that starts one is followed with
   * the link's own recipe, never by steering.
   */
  links: readonly NavLink[];
  /**
   * The navmesh's borders over a drop (M17 ticket 06, `findVoidEdges`),
   * packed eight numbers to an edge, when the Track's still geometry was at
   * hand to tell a drop from a wall. Absent, `EdgeGuard` tells them apart by
   * the navmesh alone.
   */
  voidEdges?: Float64Array;
  /**
   * Every polygon over a gated floor (M17 ticket 07, {@link GATED_FLAG}), by
   * its polygon ref, to the Segment whose floor it is. Absent or empty: the
   * Track has no trap door or fragile block.
   */
  gated?: Map<number, number>;
}

/**
 * The triangles to walk on that Recast's slope test refuses: lips (M17
 * ticket 04). A lip is a face too steep to walk, facing up, no taller than a
 * walking capsule rides over (`NAV_AGENT_CLIMB`), and touching a floor: the
 * bevel along a deck's top edge. Where two bevelled decks are butted together
 * their bevels make a groove 0.1 deep, and wherever the voxel grid put a
 * whole column inside it Recast saw a strip of unwalkable floor and eroded a
 * crack the width of a capsule across the lane (measured: a lane of seven
 * decks cracked at one seam in four, depending only on where the grid fell).
 * A capsule walks straight over it, so the navmesh must too.
 *
 * "Touching a floor" (sharing a corner with a walkable triangle) is what keeps
 * a curved slope off: tessellated finely, a quarter pipe is all faces a few
 * centimetres tall, but only its top row touches the deck above it. A slope
 * is still a slope, and a Sliding one is ticket 05's link.
 */
const lipTriangles = (positions: Float32Array, indices: Uint32Array, walkable: Uint8Array): Set<number> => {
  const key = (i: number): string => `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
  const floorCorners = new Set<string>();
  const count = indices.length / 3;
  for (let t = 0; t < count; t += 1) {
    if (walkable[t] === Recast.RC_NULL_AREA) continue;
    for (let k = 0; k < 3; k += 1) floorCorners.add(key(indices[t * 3 + k]!));
  }
  const lips = new Set<number>();
  for (let t = 0; t < count; t += 1) {
    if (walkable[t] !== Recast.RC_NULL_AREA) continue;
    const a = indices[t * 3]!;
    const b = indices[t * 3 + 1]!;
    const c = indices[t * 3 + 2]!;
    const ay = positions[a * 3 + 1]!;
    const by = positions[b * 3 + 1]!;
    const cy = positions[c * 3 + 1]!;
    if (Math.max(ay, by, cy) - Math.min(ay, by, cy) > NAV_AGENT_CLIMB) continue;
    // The normal's y, from the cross product of two edges, as Recast works it out.
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    if (uz * vx - ux * vz <= 0) continue;
    if (floorCorners.has(key(a)) || floorCorners.has(key(b)) || floorCorners.has(key(c))) lips.add(t);
  }
  return lips;
};

/** The polygon flag every walkable polygon carries, as Recast's own generator sets it. */
const WALKABLE_FLAG = 1;

/**
 * The flag of a polygon a drop bounds that is too narrow to keep a margin
 * from it in (M17 ticket 06, `markVoidEdges`): a path keeps off it where
 * there is room round.
 */
export const EDGE_STRIP_FLAG = 4;

/**
 * The flag of a polygon over a gated floor (M17 ticket 07): a trap door's
 * leaf or a fragile block, rasterised walkable at its rest pose
 * (`BotStillWorld.gatedFloors`) so a path can route over it at all. Which
 * Segment it is comes from {@link TrackNav.gated}. Included by every filter.
 */
export const GATED_FLAG = 8;

/**
 * A gated floor that is gone right now (ADR 0118: a fragile block on its
 * last arrival, until it returns). Excluded by every filter, so a plan
 * routes round it and the next plan after it returns joins again.
 * `MovingWorld.syncFragile` sets and clears it once a Tick.
 */
export const BROKEN_FLAG = 16;

/**
 * A fragile block one arrival from breaking. Excluded by no filter of its
 * own: a part asks for it (`PathHooks.planFilterFlags`, 07f), and the
 * never-stranded second plan drops it as it drops {@link EDGE_STRIP_FLAG}.
 */
export const LAST_CRACK_FLAG = 32;

const filters = new WeakMap<TrackNav, Map<number, QueryFilter>>();

/**
 * A query filter that plans as {@link TrackNav.query}'s own does, by every
 * floor's cost, over no polygon or link carrying any of `exclude`'s flags
 * (M17 ticket 06). Kept with the navmesh, one per set of flags.
 */
export const navFilterFor = (nav: TrackNav, exclude: number): QueryFilter => {
  let byFlags = filters.get(nav);
  if (byFlags === undefined) filters.set(nav, (byFlags = new Map()));
  let filter = byFlags.get(exclude);
  if (filter === undefined) {
    filter = new QueryFilter();
    filter.includeFlags = 0xffff;
    // A gone floor is nobody's route (M17 ticket 07).
    filter.excludeFlags = exclude | BROKEN_FLAG;
    for (let area = 0; area < 64; area += 1) filter.setAreaCost(area, nav.query.defaultFilter.getAreaCost(area));
    byFlags.set(exclude, filter);
  }
  return filter;
};

/**
 * The area id every link's off-mesh connection carries (M17 ticket 05). Past
 * any Surface's id (a Track has a handful) and below `forks.ts`'s penalty
 * offset, whose moved ids it must not meet.
 */
export const NAV_LINK_AREA = 31;

/**
 * How far from a polygon a link's ends may be and still join it. A link's
 * ends are points found on the navmesh, so this is only Detour's rounding.
 */
const NAV_LINK_SNAP_M = 0.2;

/** Detour's stage: the navmesh and its query from Recast's polygons, with `links` as off-mesh connections. */
const detourNav = (
  polyMesh: RecastPolyMesh,
  detail: RecastPolyMeshDetail,
  rc: ReturnType<typeof createRcConfig>,
  surfaces: readonly SurfaceId[],
  links: readonly NavLink[],
): TrackNav => {
  const params = new NavMeshCreateParams();
  params.setPolyMeshCreateParams(polyMesh);
  params.setPolyMeshDetailCreateParams(detail);
  params.setWalkableHeight(rc.walkableHeight * rc.ch);
  params.setWalkableRadius(rc.walkableRadius * rc.cs);
  params.setWalkableClimb(rc.walkableClimb * rc.ch);
  params.setCellSize(rc.cs);
  params.setCellHeight(rc.ch);
  params.setBuildBvTree(true);
  if (links.length > 0) {
    params.setOffMeshConnections(
      links.map((link, userId) => ({
        startPosition: link.from,
        endPosition: link.to,
        radius: NAV_LINK_SNAP_M,
        bidirectional: false,
        area: NAV_LINK_AREA,
        flags: WALKABLE_FLAG,
        userId,
      })),
    );
  }
  const data = createNavMeshData(params);
  if (!data.success) throw new Error("Detour data");
  const navMesh = new NavMesh();
  if (!navMesh.initSolo(data.navMeshData)) {
    data.navMeshData.destroy();
    throw new Error("solo navmesh");
  }
  return navOf(navMesh, surfaces, links);
};

/** A {@link TrackNav} around a built navmesh: its query plans by what each floor costs. */
const navOf = (navMesh: NavMesh, surfaces: readonly SurfaceId[], links: readonly NavLink[]): TrackNav => {
  const query = new NavMeshQuery(navMesh);
  surfaces.forEach((surface, area) => {
    if (area !== Recast.RC_NULL_AREA) query.defaultFilter.setAreaCost(area, navAreaCost(surface));
  });
  query.defaultFilter.setAreaCost(NAV_LINK_AREA, BOT_LINK_COST);
  // A gone floor is nobody's route (M17 ticket 07, `BROKEN_FLAG`).
  query.defaultFilter.excludeFlags = BROKEN_FLAG;
  return { navMesh, query, surfaces, links };
};

/**
 * A {@link TrackNav} as plain data (M17 ticket 05): Detour's own serialised
 * navmesh plus what it cannot carry. What crosses from the thread that built
 * it (the Match server's Bot track worker) to the one that plans on it: WASM
 * objects cannot be sent, and building on the loop every Lobby Ticks on
 * stalled every Match in the process for up to a second.
 */
export interface TrackNavData {
  readonly navMesh: Uint8Array;
  readonly surfaces: readonly SurfaceId[];
  readonly links: readonly NavLink[];
  readonly voidEdges?: Float64Array;
  /** {@link TrackNav.gated} as pairs, which cross a thread. */
  readonly gated?: readonly (readonly [number, number])[];
}

/** Serialises `nav`. The navmesh stays usable; its owner still disposes it. */
export const trackNavData = (nav: TrackNav): TrackNavData => ({
  navMesh: exportNavMesh(nav.navMesh),
  surfaces: nav.surfaces,
  links: nav.links,
  ...(nav.voidEdges === undefined ? {} : { voidEdges: nav.voidEdges }),
  ...(nav.gated === undefined ? {} : { gated: [...nav.gated.entries()] }),
});

/** Rebuilds a {@link TrackNav} from {@link trackNavData}'s output, on this thread. */
export const trackNavFromData = (data: TrackNavData): TrackNav => {
  const nav = navOf(importNavMesh(data.navMesh).navMesh, data.surfaces, data.links);
  if (data.voidEdges !== undefined) nav.voidEdges = data.voidEdges;
  if (data.gated !== undefined) nav.gated = new Map(data.gated);
  return nav;
};

/**
 * Builds the navmesh of a Track's still geometry. Throws if Recast refuses it.
 *
 * `linksOf`, when given, is asked for the links the navmesh cannot see (M17
 * ticket 05: jumps, Springs, slides), handed the navmesh without them; what it
 * returns is built in as Detour off-mesh connections, one-way, so a path
 * search crosses a gap exactly where a link was proven to.
 *
 * This is `recast-navigation`'s own solo generator, step for step, with one
 * change (M17 ticket 04): each triangle is rasterised with its Surface's
 * area id instead of one "walkable" id for all, so Recast cuts regions where
 * one floor meets another and every polygon is one Surface. The generator has
 * no hook for that, and marking polygons after the build cannot work: a mud
 * deck butted against a plain one is a single region, so one polygon would
 * straddle both.
 */
export const buildTrackNav = (
  { positions, indices, areas, surfaces }: NavInput,
  linksOf?: (plain: TrackNav) => readonly NavLink[],
): TrackNav => {
  const context = new RecastBuildContext();
  const config = { ...soloNavMeshGeneratorConfigDefaults, ...botNavConfig() };
  const rc = createRcConfig(config);
  // As the generator does: areas are given as a side, and the detail samples in cells.
  rc.minRegionArea = rc.minRegionArea * rc.minRegionArea;
  rc.mergeRegionArea = rc.mergeRegionArea * rc.mergeRegionArea;
  rc.detailSampleDist = rc.detailSampleDist < 0.9 ? 0 : rc.cs * rc.detailSampleDist;
  rc.detailSampleMaxError = rc.ch * rc.detailSampleMaxError;
  const { bbMin, bbMax } = getBoundingBox(positions, indices);
  const grid = calcGridSize(bbMin, bbMax, rc.cs);
  rc.width = grid.width;
  rc.height = grid.height;

  const triangleCount = indices.length / 3;
  const heightfield = allocHeightfield();
  const compact = allocCompactHeightfield();
  const contours = allocContourSet();
  const polyMesh = allocPolyMesh();
  const detail = allocPolyMeshDetail();
  const vertexArray = new VerticesArray();
  const triangleArray = new TrianglesArray();
  const areaArray = new TriangleAreasArray();
  try {
    if (!createHeightfield(context, heightfield, rc.width, rc.height, bbMin, bbMax, rc.cs, rc.ch)) throw new Error("heightfield");
    vertexArray.copy(positions);
    triangleArray.copy(Array.from(indices));
    areaArray.resize(triangleCount);
    markWalkableTriangles(context, rc.walkableSlopeAngle, vertexArray, indices.length, triangleArray, triangleCount, areaArray);
    // Walkable keeps its Surface's area; too steep stays Recast's null area,
    // unless it is only a lip.
    const marked = areaArray.getHeapView();
    const lips = lipTriangles(positions, indices, marked);
    for (let t = 0; t < triangleCount; t += 1) {
      if (marked[t] !== Recast.RC_NULL_AREA || lips.has(t)) marked[t] = areas[t]!;
    }
    if (!rasterizeTriangles(context, vertexArray, indices.length, triangleArray, areaArray, triangleCount, heightfield, rc.walkableClimb)) {
      throw new Error("rasterize");
    }
    filterLowHangingWalkableObstacles(context, rc.walkableClimb, heightfield);
    // Recast's ledge filter is left out (M17 ticket 05). Besides trimming a
    // floor's edge above a drop, it refuses any span whose neighbours differ by
    // more than the climb, which is its idea of "too steep"; with our climb of
    // one voxel (a capsule has no autostep) that refused every slope over 16°,
    // and with it every authored ramp (the KayKit slopes climb at 26.6°), so no
    // path ever went up a tier. Steepness is already the triangle test's, at
    // ADR 0037's own threshold; a drop still ends the floor, since neighbours
    // further apart than the climb are not joined and erosion keeps a radius
    // from any edge.
    filterWalkableLowHeightSpans(context, rc.walkableHeight, heightfield);
    if (!buildCompactHeightfield(context, rc.walkableHeight, rc.walkableClimb, heightfield, compact)) throw new Error("compact heightfield");
    if (!erodeWalkableArea(context, rc.walkableRadius, compact)) throw new Error("erode");
    if (!buildDistanceField(context, compact)) throw new Error("distance field");
    if (!buildRegions(context, compact, rc.borderSize, rc.minRegionArea, rc.mergeRegionArea)) throw new Error("regions");
    if (!buildContours(context, compact, rc.maxSimplificationError, rc.maxEdgeLen, contours, Recast.RC_CONTOUR_TESS_WALL_EDGES)) {
      throw new Error("contours");
    }
    if (!buildPolyMesh(context, contours, rc.maxVertsPerPoly, polyMesh)) throw new Error("poly mesh");
    if (!buildPolyMeshDetail(context, polyMesh, compact, rc.detailSampleDist, rc.detailSampleMaxError, detail)) throw new Error("detail mesh");
    for (let i = 0; i < polyMesh.npolys(); i += 1) {
      const area = polyMesh.areas(i);
      if (area === Recast.RC_NULL_AREA) continue;
      polyMesh.setFlags(i, WALKABLE_FLAG);
    }
    const detour = (links: readonly NavLink[]): TrackNav => detourNav(polyMesh, detail, rc, surfaces, links);
    const plain = detour([]);
    if (linksOf === undefined) return plain;
    // The links are proven on the navmesh without them (M17 ticket 05), then
    // built into the one a Bot plans over. Only Detour's stage runs twice:
    // everything Recast did is kept.
    let links: readonly NavLink[];
    try {
      links = linksOf(plain);
    } catch (error) {
      disposeTrackNav(plain);
      throw error;
    }
    if (links.length === 0) return plain;
    disposeTrackNav(plain);
    return detour(links);
  } catch (error) {
    throw new Error(`navmesh generation failed: ${(error as Error).message}`);
  } finally {
    vertexArray.destroy();
    triangleArray.destroy();
    areaArray.destroy();
    freeHeightfield(heightfield);
    freeCompactHeightfield(compact);
    freeContourSet(contours);
    freePolyMesh(polyMesh);
    freePolyMeshDetail(detail);
  }
};

/**
 * Frees a navmesh's WASM memory. Recast's objects live outside the JS heap, so
 * a Match that builds one per Round's Track (ADR 0129) must hand each back
 * when its world is replaced, or every Round leaks one.
 */
export const disposeTrackNav = (nav: TrackNav): void => {
  nav.query.destroy();
  nav.navMesh.destroy();
};

/** How far from a point a path query looks for the navmesh under it. */
const PATH_HALF_EXTENTS = { x: 2, y: 4, z: 2 };

/**
 * The corner points of the cheapest walkable path from `start` to `end`, or
 * `null` when none joins them. Cheapest by the floors it crosses
 * ({@link navAreaCost}), not shortest. When `end` cannot be reached the path
 * stops where the navmesh comes closest to it, which is a gap's edge (M17
 * ticket 01). It crosses a gap wherever a link is built in (ticket 05), a
 * link's start and landing being two corners; {@link navCorners} says which.
 */
export const navPath = (nav: TrackNav, start: Vec3, end: Vec3): Vec3[] | null => {
  const { success, path } = nav.query.computePath(start, end, { halfExtents: PATH_HALF_EXTENTS });
  return success ? path : null;
};

/** A corner of a planned path, and the link it starts, if it starts one. */
export interface NavCorner {
  readonly point: Vec3;
  /**
   * The index into {@link TrackNav.links} of the link this corner starts, or
   * `null`. The corner after it is where that link lands.
   */
  readonly link: number | null;
  /**
   * An index into the ride hook's own table when this corner starts a ride
   * on a moving floor (M17 ticket 07b), absent elsewhere. `PathFollower`
   * hands such a corner to `RideHook.steer`.
   */
  readonly ride?: number;
}

/** Detour's `DT_STRAIGHTPATH_OFFMESH_CONNECTION` flag on a string-pulled corner. */
const OFFMESH_CORNER = 4;

/**
 * {@link navPath}, telling which corners start a link (M17 ticket 05): the
 * same Detour query `computePath` makes, step for step, reading the flag and
 * the off-mesh connection each corner came from, which `computePath` drops.
 */
export const navCorners = (nav: TrackNav, start: Vec3, end: Vec3, filter?: QueryFilter): NavCorner[] | null => {
  const { query, navMesh } = nav;
  const from = query.findNearestPoly(start, { halfExtents: PATH_HALF_EXTENTS });
  if (!from.success || from.nearestRef === 0) return null;
  const to = query.findNearestPoly(end, { halfExtents: PATH_HALF_EXTENTS });
  if (!to.success || to.nearestRef === 0) return null;
  const found = query.findPath(from.nearestRef, to.nearestRef, start, end, filter === undefined ? {} : { filter });
  try {
    if (!found.success || found.polys.size === 0) return null;
    // Where the corridor stops short of `end`, string pulling ends on the polygon it stopped at.
    const lastRef = found.polys.get(found.polys.size - 1);
    let endPoint = end;
    if (lastRef !== to.nearestRef) {
      const closest = query.closestPointOnPoly(lastRef, end);
      if (!closest.success) return null;
      endPoint = closest.closestPoint;
    }
    const straight = query.findStraightPath(start, endPoint, found.polys);
    try {
      if (!straight.success) return null;
      const corners: NavCorner[] = [];
      for (let i = 0; i < straight.straightPathCount; i += 1) {
        const point = { x: straight.straightPath.get(i * 3), y: straight.straightPath.get(i * 3 + 1), z: straight.straightPath.get(i * 3 + 2) };
        const offMesh = (straight.straightPathFlags.get(i) & OFFMESH_CORNER) !== 0;
        const link = offMesh ? navMesh.getOffMeshConnectionByRef(straight.straightPathRefs.get(i)).userId() : null;
        corners.push({ point, link });
      }
      return corners;
    } finally {
      straight.straightPath.destroy();
      straight.straightPathFlags.destroy();
      straight.straightPathRefs.destroy();
    }
  } finally {
    found.polys.destroy();
  }
};

/** How far below a capsule's centre its floor is looked for, and how far to either side. */
const FLOOR_HALF_EXTENTS = { x: 0.5, y: 2, z: 0.5 };

/** The Surface of the navmesh under `point`, or `null` off the navmesh. */
export const navSurfaceAt = (nav: TrackNav, point: Vec3): SurfaceId | null => {
  const found = nav.query.findNearestPoly(point, { halfExtents: FLOOR_HALF_EXTENTS });
  if (!found.success || found.nearestRef === 0) return null;
  return nav.surfaces[nav.navMesh.getPolyArea(found.nearestRef).area] ?? DEFAULT_SURFACE;
};

/**
 * The nearest point of the navmesh to `point` that lies inside the box
 * `halfExtents` round it, or `null` (M17 ticket 06). Detour's
 * `findNearestPoly` gathers polygons by their bounds and hands back the
 * nearest point on any of them, which can be a metre outside the box: a
 * polygon along a deck's rim has bounds reaching past the rim, and one on a
 * slope reaches far above and below. Asked whether there is floor *here*,
 * that answer is only true once the point it gives back is checked.
 */
export const navFloorWithin = (nav: TrackNav, point: Vec3, halfExtents: Vec3): Vec3 | null => {
  const found = nav.query.findNearestPoly(point, { halfExtents });
  if (!found.success || found.nearestRef === 0) return null;
  const at = found.nearestPoint;
  const inside =
    Math.abs(at.x - point.x) <= halfExtents.x + 1e-4 &&
    Math.abs(at.z - point.z) <= halfExtents.z + 1e-4 &&
    Math.abs(at.y - point.y) <= halfExtents.y + 1e-4;
  return inside ? at : null;
};

/** How far round a capsule's feet the navmesh is looked for: its own radius, since the navmesh stops a radius short of every edge. */
const STANDS_ON_HALF_EXTENTS = { x: NAV_AGENT_RADIUS + 0.05, y: 0.5, z: NAV_AGENT_RADIUS + 0.05 };

/**
 * Whether a capsule centred at `position` stands over the navmesh (M17
 * ticket 05): its feet within its own radius of a polygon, at about their
 * height. Off the top of a Sliding ramp, on a post, on a railing: not.
 * The floor found must really be that near ({@link navFloorWithin}, M17
 * ticket 06): Detour's own answer counted a capsule a metre past a rim as
 * standing on it.
 */
export const navStandsOn = (nav: TrackNav, position: Vec3): boolean => {
  const feet = { x: position.x, y: position.y - CAPSULE_BOTTOM_OFFSET, z: position.z };
  const at = navFloorWithin(nav, feet, STANDS_ON_HALF_EXTENTS);
  return at !== null && Math.hypot(at.x - feet.x, at.z - feet.z) <= STANDS_ON_HALF_EXTENTS.x;
};

/** Metres between the points {@link navStraightRun} reads a Surface at: finer than any deck, coarser than a voxel. */
const RUN_SAMPLE_M = 1;

/**
 * Whether a straight run from `from` to `to` stays on the navmesh the whole
 * way (no edge, no wall), and the Surfaces it crosses, or `null` when it does
 * not. Detour's own raycast along the navmesh surface says whether the run is
 * clear (it is meant for short runs, like a Dash's); the Surfaces are read
 * every {@link RUN_SAMPLE_M} along it, because the binding's raycast does not
 * hand back the polygons it crossed.
 */
export const navStraightRun = (nav: TrackNav, from: Vec3, to: Vec3): SurfaceId[] | null => {
  const start = nav.query.findNearestPoly(from, { halfExtents: FLOOR_HALF_EXTENTS });
  if (!start.success || start.nearestRef === 0) return null;
  const hit = nav.query.raycast(start.nearestRef, start.nearestPoint, to);
  // Detour reports a run that reaches `to` with no wall as t = FLT_MAX.
  if (!hit.success || hit.t < 1) return null;
  const surfaces = new Set<SurfaceId>();
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / RUN_SAMPLE_M));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const surface = navSurfaceAt(nav, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t });
    if (surface === null) return null;
    surfaces.add(surface);
  }
  return [...surfaces];
};

/** Whether `point`, across the ground and about a metre in height, lies over one of `floor`'s pieces. */
const overGatedFloor = (floor: GatedFloor, point: Vec3): boolean => {
  // Across the ground at the box's own height (a solid may be turned on its side, so its half extents are not world axes), and within its reach in height.
  const over = (box: OrientedBox): boolean => {
    const { x, y, z } = box.halfExtents;
    return Math.abs(point.y - box.center.y) <= Math.max(x, y, z) + GATED_HEIGHT_SLACK_M && pointInOrientedBox({ x: point.x, y: box.center.y, z: point.z }, box);
  };
  if (floor.boxes.some(over)) return true;
  return floor.trimeshes.some((mesh) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of mesh.vertices) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    return point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ && point.y >= minY - GATED_HEIGHT_SLACK_M && point.y <= maxY + GATED_HEIGHT_SLACK_M;
  });
};

/** How far above or below a gated piece's own box a polygon's centre may sit and still be over it: Recast's detail mesh is a voxel or so off. */
const GATED_HEIGHT_SLACK_M = 0.5;

/**
 * Flags every polygon whose centre lies over a gated floor {@link GATED_FLAG}
 * and fills {@link TrackNav.gated} (M17 ticket 07). Run where the navmesh is
 * built, after its links are in, so both travel with it.
 */
export const markGatedPolys = (nav: TrackNav, gatedFloors: readonly GatedFloor[]): void => {
  if (gatedFloors.length === 0) return;
  const gated = new Map<number, number>();
  const tile = nav.navMesh.getTile(0);
  const header = tile.header();
  const count = header === null ? 0 : header.polyCount();
  const base = nav.navMesh.getPolyRefBase(tile);
  for (let i = 0; i < count; i += 1) {
    const poly = tile.polys(i);
    if (poly.getType() !== 0) continue;
    const n = poly.vertCount();
    const centre = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < n; k += 1) {
      const v = poly.verts(k);
      centre.x += tile.verts(v * 3) / n;
      centre.y += tile.verts(v * 3 + 1) / n;
      centre.z += tile.verts(v * 3 + 2) / n;
    }
    const floor = gatedFloors.find((candidate) => overGatedFloor(candidate, centre));
    if (floor === undefined) continue;
    const ref = base | i;
    nav.navMesh.setPolyFlags(ref, nav.navMesh.getPolyFlags(ref).flags | GATED_FLAG);
    gated.set(ref, floor.segmentIndex);
  }
  nav.gated = gated;
};
