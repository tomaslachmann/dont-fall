import RAPIER from "@dimforge/rapier3d-compat";
import { addVec3, rotateVec3ByQuat, vec3, type Vec3 } from "../math/vec3.js";
import { isPlayerDrivenMotionState } from "../simulation/CharacterStateMachine.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import type { SolidShape } from "../track/asset.js";
import { surfaceConfig, type SurfaceConfig } from "../track/Surface.js";
import {
  BOT_BRAKE_MIN_SPEED,
  BOT_CRASH_SPEED_SHARE,
  BOT_EDGE_GUARD_HEIGHT_M,
  BOT_EDGE_GUARD_SLACK_M,
  BOT_EDGE_MARGIN_M,
  BOT_EDGE_PAST_HEIGHT_M,
  BOT_EDGE_STRIP_M,
  BOT_EDGE_GUARD_STOP_TICKS_MAX,
  BOT_EDGE_VOID_DEPTH_M,
  BOT_EDGE_VOID_PROBE_M,
  BOT_GROUND_PROBE_ABOVE_M,
  BOT_ICE_WALL_MARGIN_M,
  BOT_PATH_EDGE_MARGIN_M,
  BOT_PROP_CLEARANCE_M,
  BOT_STUMBLE_EXTRA_TICKS_MAX,
  NAV_AGENT_CLIMB,
} from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { DASH_SPEED, MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR, MOVE_STOP_SPEED, MOVE_VELOCITY_CAP, WALKABLE_SLOPE_MAX_ANGLE } from "../tuning/movement.js";
import type { BotWorldView } from "./Bot.js";
import { stillQueryWorld } from "./linkProof.js";
import type { BotStillWorld } from "./navInput.js";
import { EDGE_STRIP_FLAG, navFloorWithin, navSurfaceAt, type NavCorner, type TrackNav } from "./navMesh.js";
import type { BotProfile } from "./profile.js";

/*
 * "Chaotic, never suicidal" (ADR 0129, M17 ticket 06): whatever a Bot's
 * goal or its Fight asks for, the move it sends is one that keeps it on
 * something to stand on.
 *
 * What made a Bot step off was never where it aimed but *when it saw*:
 * `withPerceptionDelay` hands a Bot its own Character a few Ticks old
 * (ticket 08), up to half a second at EASY, so it steers from where it was.
 * Walking at a corner beside an edge, it perceived itself arriving only
 * after its body had walked on past it and off (measured, ticket 06's "As
 * built"). The guard does not make a Bot see sooner. It makes each move one
 * that stays safe *wherever the Bot may really be*: the Bot knows its own
 * reflexes (its profile) and what it has pushed since (its own inputs), so it
 * plays those pushes forward from what it sees, for every staleness its
 * perception may have, and only commits to a move that, with a stop after
 * it, never crosses an edge from any of them. A clumsy Bot still steers late
 * and badly; near an edge it stops and waits for its eyes to catch up.
 */

/** Across the ground. */
const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * How many Ticks old a Bot's view of itself may be: `withPerceptionDelay`'s
 * own rule, read off the same profile (its reaction time, and the worst
 * stumble its clumsiness adds).
 */
export interface StaleWindow {
  readonly min: number;
  readonly max: number;
}

export const staleWindow = (profile: BotProfile): StaleWindow => {
  const min = Math.max(0, Math.round(profile.reactionTicks));
  return { min, max: min + Math.max(0, Math.floor(profile.clumsiness * BOT_STUMBLE_EXTRA_TICKS_MAX)) };
};

// --- The edges ---------------------------------------------------------------

/**
 * One border of the navmesh a Bot must not cross: floor on one side, a drop
 * on the other. Its outward normal points at the drop.
 */
export interface VoidEdge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** The border's height at each end, on the floor. */
  ay: number;
  by: number;
  nx: number;
  nz: number;
  /**
   * The same edge {@link BOT_EDGE_MARGIN_M} further in, and as much longer at
   * each end so the lines still meet round a corner: where a Bot's moves
   * stop. `null` on the inner line itself.
   */
  inner: VoidEdge | null;
  /** The last {@link edgesNear} call that took it. */
  seen: number;
}

/** The void edges of a navmesh in a grid, for the few round a Bot. */
export interface NavEdges {
  readonly cell: number;
  readonly grid: ReadonlyMap<number, readonly VoidEdge[]>;
}

/** Grid cell size, in metres: a Bot asks for the edges within a few metres. */
const EDGE_CELL_M = 2;
/** A grid cell's key: its two indices in one number, so looking a cell up allocates nothing. */
const cellKey = (x: number, z: number): number => (x + 32768) * 65536 + (z + 32768);

const edgesKept = new WeakMap<TrackNav, NavEdges>();

/** Numbers per edge in {@link TrackNav.voidEdges}: each end's x, y, z, then the outward normal's x and z. */
const PACKED = 8;

/**
 * Every border of the navmesh: a polygon side with no neighbour, with its
 * outward normal across the ground (away from its polygon's middle).
 */
interface Border {
  a: Vec3;
  b: Vec3;
  nx: number;
  nz: number;
  /** The polygon it bounds, by its index in the navmesh's one tile. */
  poly: number;
  /** How far the polygon reaches in from the border's line, across the ground. */
  depth: number;
}

/** Every border of `nav`, or only those of the polygons whose area `keep` says (a Surface's, `NavInput.surfaces`). */
const borders = (nav: TrackNav, keep?: (area: number) => boolean): Border[] => {
  const out: Border[] = [];
  const tile = nav.navMesh.getTile(0);
  const header = tile.header();
  const count = header === null ? 0 : header.polyCount();
  const vertex = (index: number): Vec3 => vec3(tile.verts(index * 3), tile.verts(index * 3 + 1), tile.verts(index * 3 + 2));
  for (let i = 0; i < count; i += 1) {
    const poly = tile.polys(i);
    if (poly.getType() !== 0) continue;
    if (keep !== undefined && !keep(poly.areaAndType() & 0x3f)) continue;
    const n = poly.vertCount();
    const corners = Array.from({ length: n }, (_, k) => vertex(poly.verts(k)));
    const cx = corners.reduce((sum, c) => sum + c.x, 0) / n;
    const cz = corners.reduce((sum, c) => sum + c.z, 0) / n;
    for (let k = 0; k < n; k += 1) {
      if (poly.neis(k) !== 0) continue;
      const a = corners[k]!;
      const b = corners[(k + 1) % n]!;
      const length = groundDistance(a, b);
      if (length === 0) continue;
      let nx = -(b.z - a.z) / length;
      let nz = (b.x - a.x) / length;
      if ((cx - (a.x + b.x) / 2) * nx + (cz - (a.z + b.z) / 2) * nz > 0) {
        nx = -nx;
        nz = -nz;
      }
      const depth = Math.max(...corners.map((c) => -((c.x - a.x) * nx + (c.z - a.z) * nz)));
      out.push({ a, b, nx, nz, poly: i, depth });
    }
  }
  return out;
};

/** Where past a border its floor is looked for: from a step down to well above. */
const PROBE_HALF = { x: 0.3, y: (BOT_EDGE_VOID_DEPTH_M + NAV_AGENT_CLIMB) / 2, z: 0.3 };

/** The point {@link BOT_EDGE_VOID_PROBE_M} past a border's middle, at its height. */
const pastBorder = ({ a, b, nx, nz }: Border): Vec3 =>
  vec3((a.x + b.x) / 2 + nx * BOT_EDGE_VOID_PROBE_M, (a.y + b.y) / 2, (a.z + b.z) / 2 + nz * BOT_EDGE_VOID_PROBE_M);

/** Whether the navmesh has floor past a border, from a step down to well above: a step up or a wall with floor behind it. */
const floorPast = (nav: TrackNav, past: Vec3): boolean =>
  navFloorWithin(nav, { x: past.x, y: past.y - NAV_AGENT_CLIMB + PROBE_HALF.y, z: past.z }, PROBE_HALF) !== null;

/**
 * The borders of `nav` that are edges over a drop (M17 ticket 06), asked of
 * the Track's still geometry: past each border's middle, a ray down from
 * {@link BOT_GROUND_PROBE_ABOVE_M} above its floor. Something there no lower
 * than a walk steps down (the floor going on, a wall, a post, a ball the
 * navmesh was cut round) is no drop; nothing there, or only a floor further
 * down, is. The navmesh alone cannot tell: a hole cut round a still bumper
 * and a hole in the floor are the same to it (measured, the base race's ice
 * slide, whose bumpers read as pits and stopped every Bot beside them).
 * What the ray meets first being a hazard piece (spikes, ADR 0061) makes
 * the border an edge all the same (M17 ticket 06b): a touch there knocks a
 * Character down as surely as a step over a drop takes it off.
 * Stored packed on the navmesh as {@link TrackNav.voidEdges}, and every
 * polygon a drop bounds that is narrower than {@link BOT_EDGE_STRIP_M} from
 * it is flagged an edge strip (`navFilterFor`), for a path to keep off where
 * there is room round it. Run where the navmesh is built, so both travel
 * with it. Needs `initPhysics()`.
 */
export const markVoidEdges = (nav: TrackNav, world: Pick<BotStillWorld, "statics" | "staticTrimeshes">): void => {
  const hazards = new Set<number>();
  const still = stillQueryWorld(world, hazards);
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const kept: number[] = [];
  const strips = new Set<number>();
  try {
    for (const border of borders(nav)) {
      const past = pastBorder(border);
      if (floorPast(nav, past)) continue;
      ray.origin = { x: past.x, y: past.y + BOT_GROUND_PROBE_ABOVE_M, z: past.z };
      const hit = still.castRay(ray, BOT_GROUND_PROBE_ABOVE_M + NAV_AGENT_CLIMB, true);
      // A hazard past the border (ADR 0061: spikes knock down at a touch) is
      // kept off as a drop is (M17 ticket 06b): the border runs a bare
      // capsule's radius from it (measured, the base race's spinning squares).
      if (hit !== null && !hazards.has(hit.collider.handle)) continue;
      const { a, b, nx, nz } = border;
      kept.push(a.x, a.y, a.z, b.x, b.y, b.z, nx, nz);
      if (border.depth < BOT_EDGE_STRIP_M) strips.add(border.poly);
    }
  } finally {
    still.free();
  }
  nav.voidEdges = Float64Array.from(kept);
  const tile = nav.navMesh.getTile(0);
  const base = nav.navMesh.getPolyRefBase(tile);
  for (const poly of strips) {
    const ref = base | poly;
    nav.navMesh.setPolyFlags(ref, nav.navMesh.getPolyFlags(ref).flags | EDGE_STRIP_FLAG);
  }
};

/**
 * The void edges of `nav` in a grid, for the few round a Bot (M17 ticket 06):
 * {@link markVoidEdges}' when the navmesh was built with the still geometry at
 * hand, else every border with no navmesh floor past it (a still obstacle's
 * hole then reads as a drop, which only ever holds a Bot back). Each edge
 * carries its inner line, {@link BOT_EDGE_MARGIN_M} in. Built once per
 * navmesh and kept with it.
 */
export const navEdgesOf = (nav: TrackNav): NavEdges => {
  const kept = edgesKept.get(nav);
  if (kept !== undefined) return kept;
  const { grid, add } = edgeGrid();
  const packed = nav.voidEdges;
  if (packed !== undefined) {
    for (let i = 0; i + PACKED <= packed.length; i += PACKED) {
      add(vec3(packed[i]!, packed[i + 1]!, packed[i + 2]!), vec3(packed[i + 3]!, packed[i + 4]!, packed[i + 5]!), packed[i + 6]!, packed[i + 7]!);
    }
  } else {
    for (const border of borders(nav)) if (!floorPast(nav, pastBorder(border))) add(border.a, border.b, border.nx, border.nz);
  }
  const edges = { cell: EDGE_CELL_M, grid };
  edgesKept.set(nav, edges);
  return edges;
};

const slickKept = new WeakMap<TrackNav, NavEdges>();

/**
 * Every wall bounding a floor with less than full grip (ice): its borders
 * that are not drops ({@link navEdgesOf}), in a grid (M17 ticket 06b). On
 * ice running into anything knocks a Character down (ADR 0102), so a Bot
 * keeps off a wall or a still obstacle's hole there as it keeps off a drop
 * ({@link keepOffEdges}, {@link EdgeGuard}). Built once per navmesh on first
 * asking, from its own polygons.
 */
const slickEdgesOf = (nav: TrackNav): NavEdges => {
  const kept = slickKept.get(nav);
  if (kept !== undefined) return kept;
  const { grid, add } = edgeGrid();
  // The drops among them are the void edges already: only the walls are added.
  const key = (ax: number, az: number, bx: number, bz: number): string => `${ax.toFixed(3)},${az.toFixed(3)},${bx.toFixed(3)},${bz.toFixed(3)}`;
  const drops = new Set<string>();
  for (const list of navEdgesOf(nav).grid.values()) for (const edge of list) drops.add(key(edge.ax, edge.az, edge.bx, edge.bz));
  for (const border of borders(nav, (area) => surfaceConfig(nav.surfaces[area] ?? undefined).grip < 1)) {
    if (!drops.has(key(border.a.x, border.a.z, border.b.x, border.b.z))) add(border.a, border.b, border.nx, border.nz);
  }
  const edges = { cell: EDGE_CELL_M, grid };
  slickKept.set(nav, edges);
  return edges;
};

/** An empty edge grid, and how to add an edge (with its inner line) to it. */
const edgeGrid = (): { grid: Map<number, VoidEdge[]>; add: (a: Vec3, b: Vec3, nx: number, nz: number) => void } => {
  const grid = new Map<number, VoidEdge[]>();
  const add = (a: Vec3, b: Vec3, nx: number, nz: number): void => {
    const length = groundDistance(a, b);
    const ux = (b.x - a.x) / length;
    const uz = (b.z - a.z) / length;
    const m = BOT_EDGE_MARGIN_M;
    const inner: VoidEdge = {
      ax: a.x - nx * m - ux * m,
      az: a.z - nz * m - uz * m,
      bx: b.x - nx * m + ux * m,
      bz: b.z - nz * m + uz * m,
      ay: a.y,
      by: b.y,
      nx,
      nz,
      inner: null,
      seen: 0,
    };
    const edge: VoidEdge = { ax: a.x, az: a.z, bx: b.x, bz: b.z, ay: a.y, by: b.y, nx, nz, inner, seen: 0 };
    const x0 = Math.floor(Math.min(a.x, b.x) / EDGE_CELL_M);
    const x1 = Math.floor(Math.max(a.x, b.x) / EDGE_CELL_M);
    const z0 = Math.floor(Math.min(a.z, b.z) / EDGE_CELL_M);
    const z1 = Math.floor(Math.max(a.z, b.z) / EDGE_CELL_M);
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gz = z0; gz <= z1; gz += 1) {
        const key = cellKey(gx, gz);
        const list = grid.get(key);
        if (list === undefined) grid.set(key, [edge]);
        else list.push(edge);
      }
    }
  };
  return { grid, add };
};

/**
 * The void edges within `radius` of `at`, across the ground, that could be
 * on the Bot's own floor: no further above or below its feet than a walk
 * could climb over the distance (plus {@link BOT_EDGE_GUARD_HEIGHT_M}). The
 * edge of the deck above or below is someone else's.
 */
const edgesNear = (edges: NavEdges, at: Vec3, feetY: number, radius: number, any = false): VoidEdge[] => {
  const out: VoidEdge[] = [];
  // An edge spans several cells; each is taken once a call.
  const call = (lookups += 1);
  const x0 = Math.floor((at.x - radius) / edges.cell);
  const x1 = Math.floor((at.x + radius) / edges.cell);
  const z0 = Math.floor((at.z - radius) / edges.cell);
  const z1 = Math.floor((at.z + radius) / edges.cell);
  for (let gx = x0; gx <= x1; gx += 1) {
    for (let gz = z0; gz <= z1; gz += 1) {
      const list = edges.grid.get(cellKey(gx, gz));
      if (list === undefined) continue;
      for (const edge of list) {
        if (edge.seen === call) continue;
        edge.seen = call;
        const distance = distanceTo(edge, at.x, at.z);
        if (distance > radius) continue;
        const tolerance = BOT_EDGE_GUARD_HEIGHT_M + distance * SLOPE_RISE;
        if (Math.min(edge.ay, edge.by) - tolerance > feetY || Math.max(edge.ay, edge.by) + tolerance < feetY) continue;
        out.push(edge);
        if (any) return out;
      }
    }
  }
  return out;
};

/** Counts {@link edgesNear} calls, each one's mark on the edges it has taken. */
let lookups = 0;

/**
 * The void edges within `radius` of `at` on a Bot's own floor (M17 ticket
 * 14): what the local motion planner plays its rollouts against, the same
 * edges the guard vets its moves against.
 */
export const voidEdgesNear = (nav: TrackNav, at: Vec3, feetY: number, radius: number): readonly VoidEdge[] => edgesNear(navEdgesOf(nav), at, feetY, radius);

/** The distance across the ground from `(x, z)` to the nearest of `edges` (the drops themselves, not their inner lines); `Infinity` with none. */
export const voidEdgeDistance = (edges: readonly VoidEdge[], x: number, z: number): number => {
  let best = Infinity;
  for (const edge of edges) best = Math.min(best, distanceTo(edge, x, z));
  return best;
};

/**
 * Whether going from `(x0, z0)` to `(x1, z1)` crosses one of `edges` outward,
 * over its inner line ({@link BOT_EDGE_MARGIN_M} in from the drop): where the
 * guard stops a move, a rollout is off the floor.
 */
export const crossesOut = (edges: readonly VoidEdge[], x0: number, z0: number, x1: number, z1: number): boolean => {
  for (const edge of edges) if (crossing(edge.inner ?? edge, x0, z0, x1, z1) === 1) return true;
  return false;
};

/** The edge's height at its point nearest `(x, z)`. */
const heightAt = (edge: VoidEdge, x: number, z: number): number => {
  const dx = edge.bx - edge.ax;
  const dz = edge.bz - edge.az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - edge.ax) * dx + (z - edge.az) * dz) / lengthSq));
  return edge.ay + (edge.by - edge.ay) * t;
};

/** The distance across the ground from `(x, z)` to `edge`. */
const distanceTo = (edge: VoidEdge, x: number, z: number): number => {
  const dx = edge.bx - edge.ax;
  const dz = edge.bz - edge.az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - edge.ax) * dx + (z - edge.az) * dz) / lengthSq));
  return Math.hypot(x - (edge.ax + dx * t), z - (edge.az + dz * t));
};

/**
 * Whether going from `(x0, z0)` to `(x1, z1)` crosses `edge` outward, onto
 * the drop's side: 1 out, -1 back in, 0 not at all.
 */
const crossing = (edge: VoidEdge, x0: number, z0: number, x1: number, z1: number): number => {
  const rx = x1 - x0;
  const rz = z1 - z0;
  const sx = edge.bx - edge.ax;
  const sz = edge.bz - edge.az;
  const denominator = rx * sz - rz * sx;
  if (denominator === 0) return 0;
  const qx = edge.ax - x0;
  const qz = edge.az - z0;
  const t = (qx * sz - qz * sx) / denominator;
  const u = (qx * rz - qz * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return 0;
  return rx * edge.nx + rz * edge.nz > 0 ? 1 : -1;
};

/**
 * A path's corners moved off the edges they hug (M17 ticket 06): Detour
 * pulls a path tight round every corner, a capsule's radius from the drop
 * (M17 ticket 04's open question 4), so a Bot that overshoots a corner by a
 * step is over the side. Each corner within {@link BOT_PATH_EDGE_MARGIN_M}
 * of a void edge is pushed in from it to that distance, where there is floor
 * to push it to; on a strip narrower than that it stays where it was. On a
 * floor with less than full grip every border counts, a wall's as a drop's,
 * and the margin is {@link BOT_ICE_WALL_MARGIN_M} (M17 ticket 06b). A link's
 * start is never moved: its proof was played from exactly there.
 */
export const keepOffEdges = (nav: TrackNav, corners: readonly NavCorner[]): NavCorner[] => {
  const edges = navEdgesOf(nav);
  return corners.map((corner) => {
    if (corner.link !== null) return corner;
    const { point } = corner;
    let px = 0;
    let pz = 0;
    // On ice a wall is kept off as a drop is, and further (M17 ticket 06b):
    // brushing one there knocks a Character down (ADR 0102), and a Bot
    // steering its slide round a corner there cuts inside it.
    const slick = surfaceConfig(navSurfaceAt(nav, point) ?? undefined).grip < 1;
    const margin = slick ? BOT_ICE_WALL_MARGIN_M : BOT_PATH_EDGE_MARGIN_M;
    const near = edgesNear(edges, point, point.y, margin);
    for (const edge of slick ? [...near, ...edgesNear(slickEdgesOf(nav), point, point.y, margin)] : near) {
      const short = margin - distanceTo(edge, point.x, point.z);
      if (short <= 0) continue;
      px -= edge.nx * short;
      pz -= edge.nz * short;
    }
    if (px === 0 && pz === 0) return corner;
    const moved = navFloorWithin(nav, { x: point.x + px, y: point.y, z: point.z + pz }, MOVED_HALF_EXTENTS);
    return moved === null ? corner : { ...corner, point: moved, link: null };
  });
};

/** Where a moved corner must still find floor: right under it, at about its height. */
const MOVED_HALF_EXTENTS = { x: 0.05, y: 0.5, z: 0.05 };

// --- A Bot's own motion --------------------------------------------------------

// --- Props ----------------------------------------------------------------------

/** A Prop lying round a Bot, as the guard keeps clear of it: its centre across the ground, and how near is touching it. */
interface Obstacle {
  readonly x: number;
  readonly z: number;
  readonly touch: number;
}

/** How far a solid part reaches from its own centre, whichever way it is turned: a bound, never less. */
const partReach = (shape: SolidShape): number => {
  switch (shape.type) {
    case "ball":
      return shape.radius;
    case "box":
      return Math.hypot(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    case "hull":
      return Math.max(0, ...shape.points.map((p) => Math.hypot(p.x, p.y, p.z)));
    default:
      return shape.radius + shape.halfHeight;
  }
};

const bounds = new WeakMap<PropConfig, number>();

/** How far any part of a Prop reaches from its origin, however it lies. */
const boundOf = (config: PropConfig): number => {
  let bound = bounds.get(config);
  if (bound === undefined) {
    const { shape } = config;
    bound =
      shape.kind === "ball"
        ? shape.radius
        : shape.kind === "box"
          ? Math.hypot(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z)
          : Math.max(0, ...shape.parts.map((part) => Math.hypot(part.position.x, part.position.y, part.position.z) + partReach(part.shape)));
    bounds.set(config, bound);
  }
  return bound;
};

/**
 * The Props within `reach` of a Bot (M17 ticket 06), where it sees them
 * (`BotWorldView.props`, as late as it sees everything that moves), one
 * obstacle per solid part, placed as the Prop lies now (a rolled ball's part
 * is wherever its turn took it): lying in play on about its floor, in nobody's
 * hands, and not a Shooter's ball.
 */
const propsNear = (view: BotWorldView, feetY: number, reach: number): Obstacle[] => {
  const out: Obstacle[] = [];
  const configs = view.track.resolved.props;
  const { position } = view.self;
  const add = (center: Vec3, size: number): void => {
    if (center.y + size < feetY - BOT_EDGE_GUARD_HEIGHT_M || center.y - size > feetY + BOT_EDGE_GUARD_HEIGHT_M + 2 * CAPSULE_BOTTOM_OFFSET) return;
    const touch = size + CAPSULE_RADIUS + BOT_PROP_CLEARANCE_M;
    if (Math.hypot(center.x - position.x, center.z - position.z) > reach + touch) return;
    out.push({ x: center.x, z: center.z, touch });
  };
  view.props?.forEach((prop, index) => {
    const config = configs[index];
    if (config === undefined || prop.live === false || prop.carriedBy !== undefined) return;
    if (config.projectile === true && config.bomb === undefined) return;
    // Most Props are nowhere near: one distance against the whole body's bound says so.
    if (Math.hypot(prop.position.x - position.x, prop.position.z - position.z) > reach + boundOf(config) + CAPSULE_RADIUS + BOT_PROP_CLEARANCE_M) return;
    const { shape } = config;
    if (shape.kind === "ball") add(prop.position, shape.radius);
    else if (shape.kind === "box") add(prop.position, Math.hypot(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z));
    else for (const part of shape.parts) add(addVec3(prop.position, rotateVec3ByQuat(part.position, prop.rotation)), partReach(part.shape));
  });
  return out;
};

/**
 * The other Characters within `reach` of a Bot, where it sees them, as
 * obstacles on a slick floor: there a Bot running into anyone is knocked
 * down itself (ADR 0102), which is its own doing, not a shove.
 */
const othersNear = (view: BotWorldView, feetY: number, reach: number): Obstacle[] => {
  const out: Obstacle[] = [];
  const { position } = view.self;
  const touch = 2 * CAPSULE_RADIUS + BOT_PROP_CLEARANCE_M;
  for (const [id, other] of Object.entries(view.characters)) {
    if (id === view.id || other.eliminated) continue;
    if (Math.abs(other.position.y - CAPSULE_BOTTOM_OFFSET - feetY) > BOT_EDGE_GUARD_HEIGHT_M) continue;
    if (Math.hypot(other.position.x - position.x, other.position.z - position.z) > reach + touch) continue;
    out.push({ x: other.position.x, z: other.position.z, touch });
  }
  return out;
};

/**
 * Whether going from `(x0, z0)` to `(x1, z1)` at `(vx, vz)` comes into touch
 * with one of `obstacles`, closing on it at `crash` or faster. On a floor that
 * knocks down whoever runs into something (ice, ADR 0102) that is its crash
 * speed, since leaning on a bumper at a walk's first step hurts nobody; on
 * any other floor any touch counts.
 */
const into = (obstacles: readonly Obstacle[], x0: number, z0: number, x1: number, z1: number, vx: number, vz: number, crash: number): boolean =>
  obstacles.some(({ x, z, touch }) => {
    const after = Math.hypot(x1 - x, z1 - z);
    if (after >= touch || after >= Math.hypot(x0 - x, z0 - z)) return false;
    return crash === 0 || (after > 0 && (vx * (x - x1) + vz * (z - z1)) / after >= crash);
  });

/** How much a floor may rise per metre across the ground, for which edges are about a Bot's height: the steepest walk (ADR 0037). */
const SLOPE_RISE = Math.tan(WALKABLE_SLOPE_MAX_ANGLE);

/** The turns of a refused move tried, nearest first, in radians. */
const TURNS = [Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];

/** A horizontal position and velocity, played forward. */
export interface Motion {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * Where a Bot may really be, for one staleness of its view: what it sees,
 * played forward through its own pushes since. `out` is the edge it is past
 * there, if it is: then only a move back in over that edge is safe from it.
 */
interface Start {
  readonly m: Motion;
  readonly out: VoidEdge | null;
  /** The edge whose margin it stands in, when it is not past any edge. */
  readonly band: VoidEdge | null;
}

/** The move of one Tick, as a Bot sent it. */
interface Push {
  x: number;
  z: number;
}

const STILL = vec3();

/**
 * Which of `near` the point `(x, z)` stands past, if any: the nearest one
 * at the height of feet at `feetY`, when the point is on its drop's side. At
 * a corner two edges are equally near, and their normals together say which
 * side is out; beyond the loose end of an edge that meets no other (a floor
 * going on round an obstacle), nothing is. An edge well above or below the
 * feet is another floor's: a Bot beside the foot of a tier stands past the
 * tier's edge only as seen from above.
 */
const pastEdge = (near: readonly VoidEdge[], x: number, z: number, feetY: number): VoidEdge | null => {
  const level = near.filter((edge) => Math.abs(heightAt(edge, x, z) - feetY) <= BOT_EDGE_PAST_HEIGHT_M);
  let best: VoidEdge | null = null;
  let bestDistance = Infinity;
  for (const edge of level) {
    const distance = distanceTo(edge, x, z);
    if (distance < bestDistance) {
      best = edge;
      bestDistance = distance;
    }
  }
  if (best === null) return null;
  let nx = 0;
  let nz = 0;
  let px = 0;
  let pz = 0;
  let meeting = 0;
  let inside = false;
  for (const edge of level) {
    if (distanceTo(edge, x, z) > bestDistance + 1e-6) continue;
    meeting += 1;
    nx += edge.nx;
    nz += edge.nz;
    const dx = edge.bx - edge.ax;
    const dz = edge.bz - edge.az;
    const lengthSq = dx * dx + dz * dz;
    const along = lengthSq === 0 ? 0 : ((x - edge.ax) * dx + (z - edge.az) * dz) / lengthSq;
    if (along > 0 && along < 1) inside = true;
    const t = Math.max(0, Math.min(1, along));
    px = edge.ax + dx * t;
    pz = edge.az + dz * t;
  }
  if (!inside && meeting < 2) return null;
  return (x - px) * nx + (z - pz) * nz > 1e-6 ? best : null;
};

/**
 * A Bot's guard against stepping off (M17 ticket 06, ADR 0129), and the
 * record of what it has pushed that the guard plays forward. One per Bot,
 * told every input the Bot sends ({@link record}), whoever decided it.
 *
 * - {@link guard}: the move to send instead of the one asked for. The asked
 *   move is sent when, from every place the Bot may really be (what it sees,
 *   played forward through its own last pushes, for each staleness its
 *   {@link StaleWindow} allows), one Tick of it and then stopping crosses no
 *   edge. Otherwise the nearest turn of it that does not, and failing that it
 *   stops (braking, on a slick floor). From a place past an edge only a move
 *   back in over it is safe, so a Bot pushed or drifted past one heads back
 *   for the floor: edge recovery.
 * - {@link fresh}: whether what the Bot sees of itself is where it is, because
 *   it has pushed nothing for longer than its view can be old. A link is
 *   started only then (`PathFollower`: a jump is played by its own clock from
 *   a stand, since a late view of the run-up presses jump past the edge).
 *
 * Its model of the Bot's motion is the movement model's own
 * (`accelerateVelocity`, ADR 0035) on the floor the Bot sees itself on,
 * across the ground only. What it leaves out (a slope's speed, a belt's
 * drag, a shove) is why a margin is kept and why it looks again every Tick.
 */
export class EdgeGuard {
  /** The last pushes, newest last, at most {@link StaleWindow.max} of them. */
  private readonly pushes: Push[] = [];
  /** Ticks in a row nothing was pushed. */
  private still = 0;
  /** How many Ticks this Bot has sent anything: its view cannot be older than that. */
  private sent = 0;
  /** Whether the move last asked about ran into a Prop. */
  private bumped = false;

  /** `stale`: how late this Bot sees itself ({@link staleWindow} of its profile). */
  constructor(readonly stale: StaleWindow) {}

  /** What the Bot sent this Tick. */
  record(move: Vec3, dash: boolean): void {
    const pushing = move.x !== 0 || move.z !== 0 || dash;
    this.still = pushing ? 0 : this.still + 1;
    this.sent += 1;
    if (this.stale.max === 0) return;
    this.pushes.push({ x: move.x, z: move.z });
    if (this.pushes.length > this.stale.max) this.pushes.shift();
  }

  /**
   * Whether this Bot's view of itself is where it really is: it has pushed
   * nothing for longer than its view can be old, and it shows it standing
   * (or, `hopping`, still across the ground).
   */
  fresh(self: Readonly<CharacterSnapshot>, hopping = false): boolean {
    // On a bounce deck a Bot is never seen standing, only hopping in place
    // (ADR 0094), so its feet being down is not asked (M17 ticket 06b).
    return this.still > this.stale.max && (self.grounded || hopping) && Math.hypot(self.velocity.x, self.velocity.z) < BOT_BRAKE_MIN_SPEED;
  }

  /** Ticks in a row this Bot has pushed nothing. */
  get stillTicks(): number {
    return this.still;
  }

  /**
   * The move to send instead of `move` (see the class): `move` itself
   * whenever it keeps the Bot on its floor. `dash` is whether the Bot is
   * pressing its Dash; a Dash already under way holds its own direction.
   *
   * `props` is whether to keep clear of the Props lying round (M17 ticket
   * 06): off to the side of one when a turn of the move gets past it, and on
   * a slick floor never into one, since running into anything there knocks
   * a Character down (ADR 0102). On a floor with grip a Prop no turn gets
   * past is pushed along, as a Player would. The Fight, which walks up to a
   * Prop to Lift it, asks without.
   *
   * `drift` is the floor's own flow under the Bot, units/s (M17 ticket 07c:
   * a belt), added to every Tick played here, the stop included: standing
   * still on a belt is not standing still.
   */
  guard(view: BotWorldView, move: Vec3, dash: boolean, props: boolean, drift: Vec3 | null = null): Vec3 {
    const { self, track } = view;
    const { nav } = track;
    if (!isPlayerDrivenMotionState(self.motionState) || self.dashing) return move;
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    const lo = Math.min(this.stale.min, this.sent);
    const hi = Math.min(this.stale.max, this.sent);
    const edges = navEdgesOf(nav);
    const feetY = self.position.y - CAPSULE_BOTTOM_OFFSET;
    // How far the Bot may get from what it sees before it has stopped: on a
    // floor with grip a Tick after it lets go, on a slick one much later.
    const driftSpeed = drift === null ? 0 : Math.hypot(drift.x, drift.z);
    const reachOn = (floor: SurfaceConfig): number =>
      (Math.max(speed, WALK_SPEED * floor.topSpeedMultiplier, dash ? WALK_SPEED + DASH_SPEED : 0) + driftSpeed) * TICK_DT * (hi + 2 + (floor.grip < 1 ? BOT_EDGE_GUARD_STOP_TICKS_MAX : 1)) +
      BOT_EDGE_GUARD_SLACK_M;
    // Most Ticks a Bot is nowhere near an edge or a Prop, which a lookup or two says.
    const under = surfaceConfig(navSurfaceAt(nav, self.position) ?? undefined);
    if (under.grip >= 1) {
      const reach = reachOn(under);
      if (edgesNear(edges, self.position, feetY, reach, true).length === 0 && (!props || propsNear(view, feetY, reach).length === 0)) return move;
    }
    const surface = slickestUnder(nav, self.position, self.velocity, speed, under);
    const slick = surface.grip < 1;
    const wish = WALK_SPEED * surface.topSpeedMultiplier;
    // How fast running into something must be to count: a crash on a floor that knocks down for one.
    const crash = (surface.crashKnockdown?.minSpeed ?? 0) * BOT_CRASH_SPEED_SHARE;
    const reach = reachOn(surface);
    // On a slick floor a wall is an edge too (M17 ticket 06b): brushing one
    // there knocks a Character down (ADR 0102), and a navmesh border runs a
    // bare capsule's radius from it (measured: Spin Cycle's ice catwalk, a Bot
    // hugging the border past a bar's end, knocked down by a centimetre).
    const near = slick ? [...edgesNear(edges, self.position, feetY, reach), ...edgesNear(slickEdgesOf(nav), self.position, feetY, reach)] : edgesNear(edges, self.position, feetY, reach);
    // On a slick floor running into anyone knocks a Character down too (ADR 0102).
    const lying = [...(props ? propsNear(view, feetY, reach) : []), ...(slick ? othersNear(view, feetY, reach) : [])];
    if (near.length === 0 && lying.length === 0) return move;

    const dx = drift === null ? 0 : drift.x * TICK_DT;
    const dz = drift === null ? 0 : drift.z * TICK_DT;
    const step = (m: Motion, px: number, pz: number, grip = surface.grip): void => {
      const push = grip === surface.grip ? wish : WALK_SPEED;
      accelerate(m, px * push, pz * push, grip);
      m.x += m.vx * TICK_DT + dx;
      m.z += m.vz * TICK_DT + dz;
    };
    const inners = near.map((edge) => edge.inner!);
    /**
     * The edge the way from `(x0, z0)` to where `m` is now went out over,
     * `null` if it came back in, `undefined` if neither. Against the edges
     * themselves, or against their inner lines ({@link BOT_EDGE_MARGIN_M} in).
     * Running into a Prop or someone on the way is noted ({@link bumped}).
     */
    const crossed = (x0: number, z0: number, m: Motion, lines: readonly VoidEdge[]): VoidEdge | null | undefined => {
      let out: VoidEdge | null | undefined;
      for (const edge of lines) {
        const c = crossing(edge, x0, z0, m.x, m.z);
        if (c === 1) out = edge;
        else if (c === -1 && out === undefined) out = null;
      }
      if (lying.length > 0 && into(lying, x0, z0, m.x, m.z, m.vx, m.vz, crash)) this.bumped = true;
      return out;
    };
    /** Plays `m` on through one push, as {@link crossed} says. */
    const through = (m: Motion, px: number, pz: number, lines: readonly VoidEdge[], grip?: number): VoidEdge | null | undefined => {
      const x0 = m.x;
      const z0 = m.z;
      step(m, px, pz, grip);
      return crossed(x0, z0, m, lines);
    };

    const seen = pastEdge(near, self.position.x, self.position.z, feetY);
    const starts: Start[] = [];
    for (let d = lo; d <= hi; d += 1) {
      const m: Motion = { x: self.position.x, z: self.position.z, vx: self.velocity.x, vz: self.velocity.z };
      let out = seen;
      for (let i = this.pushes.length - d; i < this.pushes.length; i += 1) {
        const crossed = through(m, this.pushes[i]!.x, this.pushes[i]!.z, near);
        if (crossed !== undefined) out = crossed;
      }
      starts.push({ m, out, band: out === null ? pastEdge(inners, m.x, m.z, feetY) : null });
    }

    /**
     * Whether pushing `(px, pz)` for a Tick and then stopping is safe from
     * every start, and whether it runs into a Prop on the way
     * ({@link bumped}). From inside, it must not go past an edge's inner
     * line; from between the two lines, it must not head further out nor go
     * past the edge; from past the edge, only straight back in.
     *
     * On a slick floor it is asked twice: as the floor is, and as if this
     * one push found grip and the stop that follows did not. Where ice meets
     * a floor with grip the capsule's own floor flickers from Tick to Tick
     * (the Surface is the contact of the Tick before), so a push that
     * reverses the Bot at once can be carried on it at ice's grip (measured,
     * Spin Cycle's ice arm).
     */
    const safe = (px: number, pz: number): boolean => {
      this.bumped = false;
      const kept = safeWith(px, pz);
      // Running into something is the floor as it is: where grip flickers in, a crash does not knock down.
      const bumped = this.bumped;
      const seam = !slick || safeWith(px, pz, 1);
      this.bumped = bumped;
      return kept && seam;
    };
    const safeWith = (px: number, pz: number, firstGrip?: number): boolean =>
      starts.every(({ m: from, out, band }) => {
        if (out !== null) return px * out.nx + pz * out.nz < -INWARD_COS;
        if (band !== null && px * band.nx + pz * band.nz > 0) return false;
        const lines = band === null ? inners : near;
        const m = { ...from };
        if (through(m, px, pz, lines, firstGrip)) return false;
        // Stopping: letting go on a floor with grip stops a capsule in the
        // Tick; on one without, pushing against the slide keeps its line and
        // only shortens it, so where it stops is one straight run away. A
        // belt carries the stop along too (M17 ticket 07c).
        if (!slick) {
          if (drift === null) return true;
          const x0 = m.x;
          const z0 = m.z;
          m.x += dx;
          m.z += dz;
          return !crossed(x0, z0, m, lines);
        }
        const x0 = m.x;
        const z0 = m.z;
        const run = brakingRun(Math.hypot(m.vx, m.vz), wish, surface.grip);
        const moving = Math.hypot(m.vx, m.vz);
        if (moving === 0 && drift === null) return true;
        if (moving > 0 && run > 0) {
          m.x += (m.vx / moving) * run;
          m.z += (m.vz / moving) * run;
        }
        // The belt carries the slide's whole stop: about twice the run's Ticks at its mean speed.
        if (drift !== null && moving > 0) {
          const stopTicks = Math.min(BOT_EDGE_GUARD_STOP_TICKS_MAX, Math.ceil((2 * run) / Math.max(moving, BOT_BRAKE_MIN_SPEED) / TICK_DT));
          m.x += dx * stopTicks;
          m.z += dz * stopTicks;
        }
        return !crossed(x0, z0, m, lines);
      });

    // The move, then its nearest turns: the first that keeps the Bot on its
    // floor and clear of the Props, else (with grip) the first that keeps it
    // on its floor and only pushes a Prop.
    const length = Math.hypot(move.x, move.z);
    let pushing: Vec3 | null = null;
    if (length > 0) {
      const ux = move.x / length;
      const uz = move.z / length;
      for (const angle of [0, ...TURNS]) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const tx = ux * c - uz * s;
        const tz = ux * s + uz * c;
        if (!safe(tx, tz)) continue;
        if (!this.bumped) return angle === 0 ? move : vec3(tx, 0, tz);
        pushing ??= angle === 0 ? move : vec3(tx, 0, tz);
      }
    }
    if (pushing !== null && !slick) return pushing;
    // Back in over the edge (or out of the margin) it may be past.
    const past = starts.find(({ out, band }) => out !== null || band !== null);
    const edge = past?.out ?? past?.band;
    if (edge !== undefined && edge !== null && safe(-edge.nx, -edge.nz)) return vec3(-edge.nx, 0, -edge.nz);
    if (slick && speed >= BOT_BRAKE_MIN_SPEED) return vec3(-self.velocity.x / speed, 0, -self.velocity.z / speed);
    return STILL;
  }
}

/**
 * How far either way along its run a Bot's floor is read: a capsule's own
 * width. Where two floors meet, the one the capsule's contact finds can be
 * either, so the slicker one is the one the guard plans for.
 */
const SURFACE_READ_M = 0.6;

/** The slickest floor under a capsule at `position`, and a little ahead and behind along its run. */
const slickestUnder = (nav: TrackNav, position: Vec3, velocity: Vec3, speed: number, under: SurfaceConfig): SurfaceConfig => {
  let slickest = under;
  if (speed === 0) return slickest;
  for (const sign of [-1, 1]) {
    const at = { x: position.x + (velocity.x / speed) * SURFACE_READ_M * sign, y: position.y, z: position.z + (velocity.z / speed) * SURFACE_READ_M * sign };
    const surface = navSurfaceAt(nav, at);
    if (surface === null) continue;
    const config = surfaceConfig(surface);
    if (config.grip < slickest.grip) slickest = config;
  }
  return slickest;
};

/**
 * One Tick of the movement model across the ground, in place: the
 * simulation's own `accelerateVelocity` (Friction, then Accelerate toward
 * the wish, then the cap, ADR 0035), step for step, without the objects it
 * allocates, since the guard plays a few hundred of them a Tick near an
 * edge. `accelerate.test`-style equality with the original is held by
 * `edgeGuard.test.ts`.
 */
export const accelerate = (m: Motion, wx: number, wz: number, grip: number): void => {
  const speed = Math.hypot(m.vx, m.vz);
  if (speed > 0) {
    const drop = Math.max(speed, MOVE_STOP_SPEED) * MOVE_FRICTION_FACTOR * grip * TICK_DT;
    const scale = Math.max(speed - drop, 0) / speed;
    m.vx *= scale;
    m.vz *= scale;
  }
  const wishSpeed = Math.hypot(wx, wz);
  if (wishSpeed > 0) {
    const dx = wx / wishSpeed;
    const dz = wz / wishSpeed;
    const add = wishSpeed - (m.vx * dx + m.vz * dz);
    if (add > 0) {
      const gain = Math.min(MOVE_ACCEL_FACTOR * grip * wishSpeed * TICK_DT, add);
      m.vx += dx * gain;
      m.vz += dz * gain;
    }
  }
  const final = Math.hypot(m.vx, m.vz);
  if (final > MOVE_VELOCITY_CAP) {
    m.vx *= MOVE_VELOCITY_CAP / final;
    m.vz *= MOVE_VELOCITY_CAP / final;
  }
};

/**
 * How far a capsule at `speed` runs on a floor of `grip` while it pushes
 * straight against its own slide at `wish`, until it is slower than
 * {@link BOT_BRAKE_MIN_SPEED}: {@link accelerate} along one line, since
 * friction and a push against the motion both only shorten it.
 */
const brakingRun = (speed: number, wish: number, grip: number): number => {
  let run = 0;
  let s = speed;
  for (let tick = 0; tick < BOT_EDGE_GUARD_STOP_TICKS_MAX && s >= BOT_BRAKE_MIN_SPEED; tick += 1) {
    s = Math.max(s - Math.max(s, MOVE_STOP_SPEED) * MOVE_FRICTION_FACTOR * grip * TICK_DT, 0);
    s = Math.max(0, s - Math.min(MOVE_ACCEL_FACTOR * grip * wish * TICK_DT, wish + s));
    run += s * TICK_DT;
  }
  return run;
};

/** How squarely a move must head back in over an edge a Bot may be past, as a cosine against the edge's inward normal. */
const INWARD_COS = 0.25;
