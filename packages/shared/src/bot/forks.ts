import type { Vec3 } from "../math/vec3.js";
import {
  BOT_FORK_ARMS_MAX,
  BOT_FORK_COST_SLACK,
  BOT_FORK_PENALTY,
  BOT_FORK_SEPARATION_M,
  BOT_LEG_JOINED_M,
  BOT_LINK_COST,
} from "../tuning/bots.js";
import { navAreaCost } from "./navInput.js";
import { NAV_LINK_AREA, navSurfaceAt, type NavCorner, type TrackNav } from "./navMesh.js";

/**
 * The arms of a fork (M17 ticket 04): where a leg of a Race can be run more
 * than one way at about the same cost, one point in the middle of each way.
 * A Bot picks one by its seeded preference and runs through it, so a Lobby's
 * Bots spread across the arms instead of all taking the cheapest.
 *
 * Found on the navmesh alone, so any Track has them without its author doing
 * anything (ADR 0129): the cheapest way is planned, then planned again with
 * every way found so far made {@link BOT_FORK_PENALTY} times as dear. A new
 * way counts as an arm when it is no dearer than {@link BOT_FORK_COST_SLACK}
 * times the cheapest, by the real costs, and runs at least
 * {@link BOT_FORK_SEPARATION_M} from every arm already found. Otherwise the
 * search stops.
 *
 * Only a leg the navmesh joins end to end is looked at. Where it does not
 * (a gap, until ticket 05's links), Detour's partial path ends wherever it
 * came closest, and a second search could end somewhere else entirely.
 *
 * @returns one point per arm, or nothing when there is no fork.
 */
export const forkArms = (nav: TrackNav, from: Vec3, to: Vec3): Vec3[] => {
  const cheapest = navRoute(nav, from, to);
  if (cheapest === null || !joins(cheapest.corners, to)) return [];
  const bestCost = routeCost(nav, cheapest.corners);
  const routes: Route[] = [cheapest];
  const lines: Vec3[][] = [samples(cheapest.corners)];
  const vias: (Vec3 | null)[] = [null];
  while (routes.length < BOT_FORK_ARMS_MAX) {
    const next = withPenalty(nav, routes, () => navRoute(nav, from, to));
    if (next === null || !joins(next.corners, to)) break;
    if (routeCost(nav, next.corners) > bestCost * BOT_FORK_COST_SLACK) break;
    const line = samples(next.corners);
    const via = widestPoint(line, lines);
    if (via === null) break;
    routes.push(next);
    lines.push(line);
    vias.push(via);
  }
  if (routes.length === 1) return [];
  // The cheapest way's own middle, measured against the arms found beside it.
  const first = widestPoint(lines[0]!, lines.slice(1));
  if (first === null) return [];
  return [first, ...(vias.slice(1) as Vec3[])];
};

interface Route {
  /** Detour's polygon corridor, start to end. */
  polys: number[];
  /** Its string-pulled corners, each marked if it starts a link (M17 ticket 05). */
  corners: NavCorner[];
}

const PATH_HALF_EXTENTS = { x: 2, y: 4, z: 2 };

/** `navPath`, keeping the polygon corridor too, which a penalty is laid on. */
const navRoute = (nav: TrackNav, start: Vec3, end: Vec3): Route | null => {
  const { query } = nav;
  const from = query.findNearestPoly(start, { halfExtents: PATH_HALF_EXTENTS });
  const to = query.findNearestPoly(end, { halfExtents: PATH_HALF_EXTENTS });
  if (!from.success || !to.success || from.nearestRef === 0 || to.nearestRef === 0) return null;
  const found = query.findPath(from.nearestRef, to.nearestRef, from.nearestPoint, to.nearestPoint);
  try {
    if (!found.success || found.polys.size === 0) return null;
    const polys = Array.from(found.polys.toTypedArray());
    const straight = query.findStraightPath(from.nearestPoint, to.nearestPoint, found.polys);
    try {
      if (!straight.success) return null;
      const corners: NavCorner[] = [];
      for (let i = 0; i < straight.straightPathCount; i += 1) {
        const point = { x: straight.straightPath.get(i * 3), y: straight.straightPath.get(i * 3 + 1), z: straight.straightPath.get(i * 3 + 2) };
        const offMesh = (straight.straightPathFlags.get(i) & OFFMESH_CORNER) !== 0;
        corners.push({ point, link: offMesh ? nav.navMesh.getOffMeshConnectionByRef(straight.straightPathRefs.get(i)).userId() : null });
      }
      return { polys, corners };
    } finally {
      straight.straightPath.destroy();
      straight.straightPathFlags.destroy();
      straight.straightPathRefs.destroy();
    }
  } finally {
    found.polys.destroy();
  }
};

/**
 * Where a penalised way's polygons are moved to while the next arm is looked
 * for: their own area plus this, costing {@link BOT_FORK_PENALTY} times as
 * much. Detour has 64 area ids and a Track uses one per Surface.
 */
const PENALTY_AREA_OFFSET = 32;

/** Runs `search` with every polygon of `routes` made dearer, then puts every area back as it was. */
const withPenalty = <T>(nav: TrackNav, routes: readonly Route[], search: () => T): T => {
  const { navMesh, query } = nav;
  const original = new Map<number, number>();
  for (const route of routes) {
    for (const ref of route.polys) if (!original.has(ref)) original.set(ref, navMesh.getPolyArea(ref).area);
  }
  nav.surfaces.forEach((surface, area) => {
    query.defaultFilter.setAreaCost(area + PENALTY_AREA_OFFSET, navAreaCost(surface) * BOT_FORK_PENALTY);
  });
  // A way across a link (M17 ticket 05) is penalised like any other stretch of it.
  query.defaultFilter.setAreaCost(NAV_LINK_AREA + PENALTY_AREA_OFFSET, BOT_LINK_COST * BOT_FORK_PENALTY);
  for (const [ref, area] of original) navMesh.setPolyArea(ref, area + PENALTY_AREA_OFFSET);
  try {
    return search();
  } finally {
    for (const [ref, area] of original) navMesh.setPolyArea(ref, area);
  }
};

const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);
const distance3 = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

const joins = (corners: readonly NavCorner[], to: Vec3): boolean => {
  const last = corners[corners.length - 1];
  return last !== undefined && groundDistance(last.point, to) <= BOT_LEG_JOINED_M;
};

/** Detour's `DT_STRAIGHTPATH_OFFMESH_CONNECTION` flag on a string-pulled corner. */
const OFFMESH_CORNER = 4;

/** Metres between the points a way is measured at. Finer only costs time: an arm is metres wide. */
const SAMPLE_STEP_M = 1;

/**
 * Points along a way, every {@link SAMPLE_STEP_M}, its corners included. A
 * link's stretch gives only its two ends (M17 ticket 05): what lies between
 * them is air, and an arm's middle found there would be a via no Bot can
 * stand on.
 */
const samples = (corners: readonly NavCorner[]): Vec3[] => {
  const out: Vec3[] = corners.length > 0 ? [corners[0]!.point] : [];
  for (let i = 1; i < corners.length; i += 1) {
    const a = corners[i - 1]!.point;
    const b = corners[i]!.point;
    if (corners[i - 1]!.link !== null) {
      out.push(b);
      continue;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / SAMPLE_STEP_M));
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
};

/** What running a way costs: each stretch's length times its floor's cost (a link's, across one), as the path search counts it. */
const routeCost = (nav: TrackNav, corners: readonly NavCorner[]): number => {
  let cost = 0;
  for (let c = 1; c < corners.length; c += 1) {
    const from = corners[c - 1]!;
    const to = corners[c]!;
    if (from.link !== null) {
      cost += distance3(from.point, to.point) * BOT_LINK_COST;
      continue;
    }
    const points = samples([{ point: from.point, link: null }, to]);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      const surface = navSurfaceAt(nav, middle);
      cost += distance3(a, b) * (surface === null ? 1 : navAreaCost(surface));
    }
  }
  return cost;
};

/** Ground distance from `point` to the nearest of `line`'s samples. */
const distanceToLine = (point: Vec3, line: readonly Vec3[]): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (const sample of line) nearest = Math.min(nearest, groundDistance(point, sample));
  return nearest;
};

/**
 * The middle of where `line` runs furthest from every one of `others`, or
 * `null` when it never gets {@link BOT_FORK_SEPARATION_M} from them. "The
 * middle" because two straight arms side by side are equally far apart all
 * the way along, and a point at either end would sit where they split.
 */
const widestPoint = (line: readonly Vec3[], others: readonly (readonly Vec3[])[]): Vec3 | null => {
  const apart = line.map((point) => Math.min(...others.map((other) => distanceToLine(point, other))));
  const widest = Math.max(...apart);
  if (widest < BOT_FORK_SEPARATION_M) return null;
  // Everything within a little of the widest, which is the arm's straight middle.
  const plateau = line.filter((_, i) => apart[i]! >= widest - SAMPLE_STEP_M);
  return plateau[Math.floor(plateau.length / 2)]!;
};
