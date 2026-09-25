import { conjugateQuat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, subVec3, type Quat, type Vec3 } from "../math/vec3.js";
import { movingSegmentPose, type MovingSegmentConfig } from "../simulation/MovingSegment.js";
import { fragileStanding, type FragileState } from "../track/Fragile.js";
import type { MotionClock, MotionPose, SegmentMotion } from "../track/Motion.js";
import { punchLanded } from "../track/Punch.js";
import { trapDoorShut } from "../track/TrapDoor.js";
import type { ResolvedTrack } from "../track/resolveTrack.js";
import {
  BOT_CROSS_PROBE_RADIUS_SHARE,
  BOT_HOLD_MARGIN_M,
  BOT_LOOK_AHEAD_TICKS_MAX,
  BOT_RIDE_DECK_MIN_M2,
  BOT_RIDE_HULL_SIMPLIFY_M,
  BOT_RIDE_NEAR_FLOOR_M,
  BOT_RIDE_TOP_TOLERANCE_M,
  NAV_AGENT_CLIMB,
} from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { BROKEN_FLAG, CROSS_SWATH_FLAG, LAST_CRACK_FLAG, navFloorWithin, type TrackNav } from "./navMesh.js";

/**
 * What a moving body is to a runner (M17 ticket 07): a `floor` it rides, a
 * `sweeper` that hits it (gloves included), a `gate` that is a floor only
 * while shut (a trap door's leaf), or a `fragile` floor that breaks.
 */
export type MovingRole = "floor" | "sweeper" | "gate" | "fragile";

/** One oriented 2D box in a body's local frame, with its local height range. */
export interface Hitbox {
  readonly cx: number;
  readonly cz: number;
  readonly hx: number;
  readonly hz: number;
  readonly yaw: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface MovingBody {
  /** Into `resolved.movingSegments`. */
  readonly index: number;
  readonly config: MovingSegmentConfig;
  readonly role: MovingRole;
  /**
   * Horizontal footprint, local frame: one oriented 2D box per box/solid,
   * trimeshes as their local AABB, each with its local y range. Sweeper
   * occupancy tests against these.
   */
  readonly hitboxes: readonly Hitbox[];
  /** Radius of the smallest disc about the local origin holding every hitbox: the `near` test. */
  readonly radius: number;
  /** Floors, gates and fragile blocks: the walkable top's outline (its own geometry's convex hull, simplified by {@link BOT_RIDE_HULL_SIMPLIFY_M}, so a disc is a disc) in the local XZ plane, and its local y. */
  readonly deck: { hull: readonly { x: number; z: number }[]; y: number } | null;
  readonly spiked: boolean;
}

/** Sweepers on one axle that together leave no straight window (M17 ticket 07i, round 3): Spin Cycle's cross is two bars. */
export interface Cross {
  readonly bodies: readonly MovingBody[];
  /** The axle, in world space: the bodies' shared rest origin. */
  readonly pivot: Vec3;
  /** The furthest any of them reaches from the pivot. */
  readonly radius: number;
}

/** Floor bodies moving as one: Spin Cycle's carousel is eight quarter pieces with one spin. */
export interface Platform {
  readonly index: number;
  readonly bodies: readonly MovingBody[];
  /** `bodies[0]`'s frame is the platform frame; the hull is every body's deck hull, in it. */
  readonly deck: { hull: readonly { x: number; z: number }[]; y: number };
  /** Ticks of one whole cycle at pace 1 (a spin: one turn; back-and-forth: the period), for phase tables. */
  readonly periodTicks: number;
}

/**
 * Every body of a Track that moves, switches off or breaks, and where each is
 * at any Tick (M17 ticket 07). On the authority every Motion, trap door and
 * glove is a pure function of the Tick (ADR 0061/0117/0121/0123), so a Bot
 * can ask where a body *will* be; the answers are cached per (body, Tick)
 * and shared by every Bot on the Track.
 */
export interface MovingWorld {
  readonly bodies: readonly MovingBody[];
  readonly floors: readonly MovingBody[];
  /** Role `sweeper`, gloves included. */
  readonly sweepers: readonly MovingBody[];
  /** Trap door leaves. */
  readonly gates: readonly MovingBody[];
  readonly fragile: readonly MovingBody[];
  readonly platforms: readonly Platform[];
  /**
   * Crosses (M17 ticket 07i, round 3): the sweepers on one axle, spinning
   * about a fixed pivot, that no straight walk through their swath clears —
   * at the best point of a ring inside the swath, the longest gap between arms
   * over one turn is shorter than a walk across the swath's width. A first
   * plan keeps beside one where the lane has room (`PathFollower`).
   */
  readonly crosses: readonly Cross[];
  /** World pose of body `i` at `tick`. Cached per (body, tick) in a ring of `BOT_LOOK_AHEAD_TICKS_MAX + 2` Ticks; a new clock flushes it. */
  poseAt(i: number, tick: number, clock: MotionClock): MotionPose;
  /** World velocity of world point `p` on body `i` over tick → tick + 1 (`motionPointVelocity`'s rule, through the pose cache). */
  velocityAt(i: number, tick: number, clock: MotionClock, p: Vec3): Vec3;
  /** Whether body `i` is solid at `tick`: a trap door shut, a glove out, a fragile floor standing by `fragile`, everything else always. */
  solidAt(i: number, tick: number, fragile: readonly Readonly<FragileState>[] | undefined): boolean;
  /** Whether world point `p` (a capsule centre) is inside body `i`'s hitboxes at `tick`, grown by `grow` metres across; the y test uses the capsule's own height range. */
  occupies(i: number, tick: number, clock: MotionClock, p: Vec3, grow: number): boolean;
  /** Bodies whose origin path over [tick, tick + window] comes within `radius + reach` of `p`, from the pose cache. Most Ticks: none. */
  near(p: Vec3, reach: number, tick: number, window: number, clock: MotionClock, roles?: readonly MovingRole[]): readonly MovingBody[];
  /** The platform whose deck hull holds world point `p` at `tick`, its feet within `NAV_AGENT_CLIMB` above its top or `below` under it (a lip, M17 ticket 07b), or null. */
  platformUnder(p: Vec3, tick: number, clock: MotionClock, below?: number): Platform | null;
  /** World → platform-local (and back) at `tick`, for the ride hook. */
  toLocal(platform: Platform, tick: number, clock: MotionClock, p: Vec3): Vec3;
  toWorld(platform: Platform, tick: number, clock: MotionClock, local: Vec3): Vec3;
  /**
   * Sets `BROKEN_FLAG` on a gone fragile block's polygons and `LAST_CRACK_FLAG`
   * on one arrival from breaking, and clears both as it returns (M17 ticket
   * 07). Called once a Tick by the driver, from the **undelayed** state. Only
   * a change touches the navmesh.
   */
  syncFragile(nav: TrackNav, fragile: readonly Readonly<FragileState>[] | undefined): void;
}

const FRAGILE_FLAGS = BROKEN_FLAG | LAST_CRACK_FLAG;

/** Whether `q` turns about y alone, so a box under it stays an oriented 2D box. */
const isYaw = (q: Quat): boolean => Math.abs(q.x) < 1e-3 && Math.abs(q.z) < 1e-3;
const yawOf = (q: Quat): number => 2 * Math.atan2(q.y, q.w);

/** The hitbox of a set of local points: their AABB, unrotated. */
const boundsHitbox = (points: readonly Vec3[]): Hitbox => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2, yaw: 0, yMin: minY, yMax: maxY };
};

const CORNER_SIGNS: readonly [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

/** The eight corners of a box of `half` extents at `position` turned by `rotation`. */
const boxCorners = (half: Vec3, position: Vec3, rotation: Quat): Vec3[] =>
  CORNER_SIGNS.map(([sx, sy, sz]) => addVec3(rotateVec3ByQuat({ x: sx * half.x, y: sy * half.y, z: sz * half.z }, rotation), position));

/** Every vertex of the body's collision geometry, local frame: box corners, solids' corners or hull points, trimesh vertices. */
const geometryPoints = (config: MovingSegmentConfig): Vec3[] => {
  const out: Vec3[] = [];
  for (const { box } of config.boxes) out.push(...boxCorners(box.halfExtents, box.center, { x: 0, y: 0, z: 0, w: 1 }));
  for (const { shape, position, rotation } of config.solids) {
    switch (shape.type) {
      case "hull":
        for (const p of shape.points) out.push(addVec3(rotateVec3ByQuat(p, rotation), position));
        break;
      case "box":
        out.push(...boxCorners(shape.halfExtents, position, rotation));
        break;
      case "ball":
        out.push(...boxCorners({ x: shape.radius, y: shape.radius, z: shape.radius }, position, rotation));
        break;
      case "capsule":
        out.push(...boxCorners({ x: shape.radius, y: shape.halfHeight + shape.radius, z: shape.radius }, position, rotation));
        break;
      case "cylinder":
        out.push(...boxCorners({ x: shape.radius, y: shape.halfHeight, z: shape.radius }, position, rotation));
        break;
    }
  }
  for (const mesh of config.trimeshes) out.push(...mesh.vertices);
  return out;
};

/** The walkable top's outline: the convex hull of the geometry's points within `NAV_AGENT_CLIMB` of the top, simplified; the hitboxes' when that is degenerate. */
const deckOutline = (config: MovingSegmentConfig, topBoxes: readonly Hitbox[], top: number): { x: number; z: number }[] => {
  const points = geometryPoints(config).filter((p) => p.y >= top - NAV_AGENT_CLIMB);
  const hull = simplifyHull(convexHull(points.map((p) => ({ x: p.x, z: p.z }))), BOT_RIDE_HULL_SIMPLIFY_M);
  return hull.length >= 3 ? hull : convexHull(topBoxes.flatMap(hitboxCorners));
};

const hitboxesOf = (config: MovingSegmentConfig): Hitbox[] => {
  const out: Hitbox[] = [];
  for (const { box } of config.boxes) {
    out.push({ cx: box.center.x, cz: box.center.z, hx: box.halfExtents.x, hz: box.halfExtents.z, yaw: 0, yMin: box.center.y - box.halfExtents.y, yMax: box.center.y + box.halfExtents.y });
  }
  for (const { shape, position, rotation } of config.solids) {
    let half: Vec3;
    switch (shape.type) {
      case "box":
        half = shape.halfExtents;
        break;
      case "ball":
        half = { x: shape.radius, y: shape.radius, z: shape.radius };
        break;
      case "capsule":
        half = { x: shape.radius, y: shape.halfHeight + shape.radius, z: shape.radius };
        break;
      case "cylinder":
        half = { x: shape.radius, y: shape.halfHeight, z: shape.radius };
        break;
      case "hull":
        out.push(boundsHitbox(shape.points.map((p) => addVec3(rotateVec3ByQuat(p, rotation), position))));
        continue;
    }
    if (isYaw(rotation)) {
      out.push({ cx: position.x, cz: position.z, hx: half.x, hz: half.z, yaw: yawOf(rotation), yMin: position.y - half.y, yMax: position.y + half.y });
    } else {
      out.push(boundsHitbox(boxCorners(half, position, rotation)));
    }
  }
  for (const mesh of config.trimeshes) if (mesh.vertices.length > 0) out.push(boundsHitbox(mesh.vertices));
  return out;
};

/** A hitbox's four top corners in the local XZ plane. */
const hitboxCorners = (h: Hitbox): { x: number; z: number }[] => {
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  return [
    [-h.hx, -h.hz], [h.hx, -h.hz], [h.hx, h.hz], [-h.hx, h.hz],
  ].map(([u, v]) => ({ x: h.cx + u! * c - v! * s, z: h.cz + u! * s + v! * c }));
};

/** The convex hull of `points` (Andrew's monotone chain), counter-clockwise in XZ. */
export const convexHull = (points: readonly { x: number; z: number }[]): { x: number; z: number }[] => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return sorted;
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: { x: number; z: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: { x: number; z: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
};

/**
 * `hull` with every vertex dropped that lies within `epsilon` of the chord
 * between its neighbours, smallest deviation first (M17 ticket 07b). A convex
 * outline only ever shrinks by that, so a disc's ~200 exported vertices become
 * a dozen the ride's rim probes can afford, all inside the real deck.
 */
export const simplifyHull = (hull: readonly { x: number; z: number }[], epsilon: number): { x: number; z: number }[] => {
  const out = [...hull];
  const deviation = (i: number): number => {
    const a = out[(i + out.length - 1) % out.length]!;
    const p = out[i]!;
    const b = out[(i + 1) % out.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const length = Math.hypot(ex, ez);
    return length === 0 ? 0 : Math.abs(ex * (p.z - a.z) - ez * (p.x - a.x)) / length;
  };
  while (out.length > 3) {
    let least = 0;
    for (let i = 1; i < out.length; i += 1) if (deviation(i) < deviation(least)) least = i;
    if (deviation(least) > epsilon) break;
    out.splice(least, 1);
  }
  return out;
};

/** Whether `p` lies in the convex, counter-clockwise `hull` (on its edge counts). */
export const inHull = (hull: readonly { x: number; z: number }[], p: { x: number; z: number }): boolean => {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    if ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) < -1e-9) return false;
  }
  return true;
};

/** The pose a body's Motion stopped leaves it in: its placement. */
const restPose = (config: MovingSegmentConfig): MotionPose => ({ rotation: config.orientation, position: config.position });

const apply = (pose: MotionPose, p: Vec3): Vec3 => addVec3(rotateVec3ByQuat(p, pose.rotation), pose.position);
const unapply = (pose: MotionPose, p: Vec3): Vec3 => rotateVec3ByQuat(subVec3(p, pose.position), conjugateQuat(pose.rotation));

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const vecKey = (v: Vec3): string => `${round3(v.x)},${round3(v.y)},${round3(v.z)}`;

/** A point on the world line through `pivot` along `axis`: the one nearest the origin, so two pieces on one axle share it. */
const axisLineKey = (config: MovingSegmentConfig, axis: Vec3, pivot: Vec3): string => {
  const a = rotateVec3ByQuat(axis, config.orientation);
  const length = Math.hypot(a.x, a.y, a.z) || 1;
  const unit = { x: a.x / length, y: a.y / length, z: a.z / length };
  // Flip so the same axle read either way keys the same.
  const sign = unit.x < 0 || (unit.x === 0 && (unit.y < 0 || (unit.y === 0 && unit.z < 0))) ? -1 : 1;
  const u = { x: unit.x * sign, y: unit.y * sign, z: unit.z * sign };
  const p = apply(restPose(config), { x: pivot.x * config.scale, y: pivot.y * config.scale, z: pivot.z * config.scale });
  const along = p.x * u.x + p.y * u.y + p.z * u.z;
  return `${vecKey(u)}|${vecKey({ x: p.x - u.x * along, y: p.y - u.y * along, z: p.z - u.z * along })}|${sign}`;
};

/** What makes two floors one platform: the same Motion about the same world axis line or along the same world offset. */
const platformKey = (config: MovingSegmentConfig, index: number): string => {
  if (config.under !== undefined && config.under.length > 0) return `own:${index}`;
  const m: SegmentMotion = config.motion;
  const parts: string[] = [];
  if (m.spin) parts.push(`spin:${axisLineKey(config, m.spin.axis, m.spin.pivot)}:${m.spin.speed}:${m.spin.startAngle ?? 0}`);
  if (m.swing) {
    parts.push(`swing:${axisLineKey(config, m.swing.axis, m.swing.pivot)}:${m.swing.amplitude}:${m.swing.period}:${m.swing.easing}:${m.swing.pause ?? 0}:${m.swing.phase ?? 0}`);
  }
  if (m.slide) {
    const offset = rotateVec3ByQuat({ x: m.slide.offset.x * config.scale, y: m.slide.offset.y * config.scale, z: m.slide.offset.z * config.scale }, config.orientation);
    parts.push(`slide:${vecKey(offset)}:${m.slide.period}:${m.slide.easing}:${m.slide.pause ?? 0}:${m.slide.phase ?? 0}`);
  }
  if (m.ramp) parts.push(`ramp:${m.ramp.multiplier}:${m.ramp.seconds}`);
  return parts.length === 0 ? `own:${index}` : parts.join("|");
};

/** Ticks of one whole cycle at pace 1: a spin's turn, a back-and-forth's period; several, the longest. */
const periodTicksOf = (motion: SegmentMotion): number => {
  let ticks = 1;
  if (motion.spin && motion.spin.speed !== 0) ticks = Math.max(ticks, (2 * Math.PI) / Math.abs(motion.spin.speed) / TICK_DT);
  if (motion.swing) ticks = Math.max(ticks, motion.swing.period / TICK_DT);
  if (motion.slide) ticks = Math.max(ticks, motion.slide.period / TICK_DT);
  return Math.max(1, Math.round(ticks));
};

/**
 * Sets {@link CROSS_SWATH_FLAG} on every polygon whose centre lies under a
 * cross's swath (M17 ticket 07i, round 3): within its swept radius plus the
 * hold's margin of its pivot across the ground, and no lower under its arms
 * than a Character stands. Runs once per world, on the navmesh it was built for.
 */
const markCrossSwaths = (nav: TrackNav, crosses: readonly MovingBody[], rests: readonly Vec3[], grow: number): number => {
  let marked = 0;
  if (crosses.length === 0) return marked;
  const tile = nav.navMesh.getTile(0);
  const header = tile.header();
  const count = header === null ? 0 : header.polyCount();
  const base = nav.navMesh.getPolyRefBase(tile);
  const swaths = crosses.map((body) => {
    const rest = rests[body.index]!;
    let yLo = Infinity;
    let yHi = -Infinity;
    for (const h of body.hitboxes) {
      yLo = Math.min(yLo, h.yMin);
      yHi = Math.max(yHi, h.yMax);
    }
    return { x: rest.x, z: rest.z, within: body.radius + grow, yLo: rest.y + yLo - 2 * CAPSULE_BOTTOM_OFFSET, yHi: rest.y + yHi };
  });
  for (let i = 0; i < count; i += 1) {
    const poly = tile.polys(i);
    if (poly.getType() !== 0) continue;
    const n = poly.vertCount();
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < n; k += 1) {
      const v = poly.verts(k);
      cx += tile.verts(v * 3) / n;
      cy += tile.verts(v * 3 + 1) / n;
      cz += tile.verts(v * 3 + 2) / n;
    }
    if (!swaths.some((s) => cy >= s.yLo && cy <= s.yHi && Math.hypot(s.x - cx, s.z - cz) <= s.within)) continue;
    const ref = base | i;
    nav.navMesh.setPolyFlags(ref, nav.navMesh.getPolyFlags(ref).flags | CROSS_SWATH_FLAG);
    marked += 1;
  }
  return marked;
};

/** Whether the body's Motion carries its local origin anywhere (a spin about its own origin does not). */
const originMoves = (config: MovingSegmentConfig): boolean => {
  const at0 = movingSegmentPose(config, 0, null).position;
  for (const tick of [7, 61, 233]) {
    const p = movingSegmentPose(config, tick, null).position;
    if (Math.hypot(p.x - at0.x, p.y - at0.y, p.z - at0.z) > 1e-6) return true;
  }
  return false;
};

/**
 * Reads every moving body of `resolved` (M17 ticket 07): its role, its
 * hitboxes, its deck, and the platforms floors moving as one make. Build
 * cost: one `navFloorWithin` per body and hulls of a few dozen points.
 *
 * Role: `fragile` if it breaks; `gate` if it is a trap door's leaf; `sweeper`
 * if it punches or is a hazard; else a **floor** iff, over the pieces sharing
 * its Motion, some top at rest lies within `BOT_RIDE_TOP_TOLERANCE_M` of a
 * still navmesh floor within `BOT_RIDE_NEAR_FLOOR_M` of its footprint — or
 * of another floor's, at its level (M17 ticket 07e: the middle carousel of
 * three a metre apart, or a turntable between turntables, has no still floor
 * near it at all) — and the tops' area is at least `BOT_RIDE_DECK_MIN_M2`;
 * else a sweeper. A bar's top is 1.8 m up, a sliding wall's 3 m, a hanging
 * ball's higher; a slide row over the void has still rows 2 m away at its
 * own height.
 */
export const movingWorldOf = (resolved: ResolvedTrack, nav: TrackNav): MovingWorld => {
  // Every body's geometry first; a floor is decided per Motion group below.
  const read = resolved.movingSegments.map((config, index) => {
    const hitboxes = hitboxesOf(config);
    const spiked = config.solids.some((s) => s.hazard === "spiked") || config.trimeshes.some((m) => m.hazard === "spiked");
    const hazard = config.solids.some((s) => s.hazard !== undefined) || config.trimeshes.some((m) => m.hazard !== undefined);
    let radius = 0;
    for (const h of hitboxes) for (const c of hitboxCorners(h)) radius = Math.max(radius, Math.hypot(c.x, c.z));
    const top = hitboxes.reduce((y, h) => Math.max(y, h.yMax), -Infinity);
    const topBoxes = hitboxes.filter((h) => h.yMax >= top - NAV_AGENT_CLIMB);
    let role: MovingRole | null;
    if (config.fragile !== undefined) role = "fragile";
    else if (config.trapDoor !== undefined) role = "gate";
    else if (config.punch !== undefined || hazard) role = "sweeper";
    else role = null;
    const area = topBoxes.reduce((sum, h) => sum + 4 * h.hx * h.hz, 0);
    const rest = restPose(config);
    const nearFloor =
      role === null &&
      topBoxes.some((h) => {
        const centre = apply(rest, { x: h.cx, y: top, z: h.cz });
        // The box's own half-diagonal: a deck turned 45° (the base race's spinning squares) reaches its corners, not its sides.
        const reach = Math.hypot(h.hx, h.hz) + BOT_RIDE_NEAR_FLOOR_M;
        return navFloorWithin(nav, centre, { x: reach, y: BOT_RIDE_TOP_TOLERANCE_M, z: reach }) !== null;
      });
    return { index, config, role, hitboxes, radius, top, topBoxes, area, nearFloor, spiked };
  });
  // Near a floor is near floor too (M17 ticket 07e): a deck whose only neighbours move is still a deck, so nearness spreads
  // from the still floor across decks at one level, footprint circle to footprint circle, until nothing new is reached.
  const restTop = (b: (typeof read)[number]): Vec3 => apply(restPose(b.config), { x: 0, y: b.top, z: 0 });
  for (let spread = true; spread; ) {
    spread = false;
    for (const b of read) {
      if (b.role !== null || b.nearFloor) continue;
      const at = restTop(b);
      for (const f of read) {
        if (f.role !== null || !f.nearFloor || f === b) continue;
        const of = restTop(f);
        if (Math.abs(of.y - at.y) > BOT_RIDE_TOP_TOLERANCE_M) continue;
        if (Math.hypot(of.x - at.x, of.z - at.z) > b.radius + f.radius + BOT_RIDE_NEAR_FLOOR_M) continue;
        b.nearFloor = true;
        spread = true;
        break;
      }
    }
  }
  // Floor or sweeper is asked of the pieces moving as one (M17 ticket 07b: a
  // disc's inner quarters are further from still floor than its rim, and are
  // the same deck). The deck's level is the tops of the pieces near still
  // floor; a piece at that level is a floor with them, a bar over it is not.
  const groupOf = (b: (typeof read)[number]): string => platformKey(b.config, b.index);
  const deckLevel = new Map<string, number>();
  for (const b of read) {
    if (b.role !== null || !b.nearFloor) continue;
    const key = groupOf(b);
    deckLevel.set(key, Math.min(deckLevel.get(key) ?? Infinity, apply(restPose(b.config), { x: 0, y: b.top, z: 0 }).y));
  }
  const atDeck = (b: (typeof read)[number]): boolean => {
    const level = deckLevel.get(groupOf(b));
    return level !== undefined && Math.abs(apply(restPose(b.config), { x: 0, y: b.top, z: 0 }).y - level) <= BOT_RIDE_TOP_TOLERANCE_M;
  };
  const groupArea = new Map<string, number>();
  for (const b of read) if (b.role === null && atDeck(b)) groupArea.set(groupOf(b), (groupArea.get(groupOf(b)) ?? 0) + b.area);
  const bodies: MovingBody[] = read.map((b) => {
    let role: MovingRole | null = b.role;
    if (role === null) role = atDeck(b) && (groupArea.get(groupOf(b)) ?? 0) >= BOT_RIDE_DECK_MIN_M2 ? "floor" : "sweeper";
    const deck = role === "floor" || role === "gate" || role === "fragile" ? { hull: deckOutline(b.config, b.topBoxes, b.top), y: b.top } : null;
    return { index: b.index, config: b.config, role, hitboxes: b.hitboxes, radius: b.radius, deck, spiked: b.spiked };
  });
  const floors = bodies.filter((b) => b.role === "floor");
  const sweepers = bodies.filter((b) => b.role === "sweeper");
  const gates = bodies.filter((b) => b.role === "gate");
  const fragile = bodies.filter((b) => b.role === "fragile");

  // Platforms: floors sharing one Motion in world space.
  const groups = new Map<string, MovingBody[]>();
  for (const body of floors) {
    const key = platformKey(body.config, body.index);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [body]);
    else group.push(body);
  }
  const platforms: Platform[] = [...groups.values()].map((members, index) => {
    const frame = restPose(members[0]!.config);
    const points: { x: number; z: number }[] = [];
    let y = 0;
    for (const body of members) {
      const rest = restPose(body.config);
      const deck = body.deck!;
      for (const corner of deck.hull) {
        const local = unapply(frame, apply(rest, { x: corner.x, y: deck.y, z: corner.z }));
        points.push({ x: local.x, z: local.z });
        y += local.y / (deck.hull.length * members.length);
      }
    }
    return { index, bodies: members, deck: { hull: simplifyHull(convexHull(points), BOT_RIDE_HULL_SIMPLIFY_M), y }, periodTicks: periodTicksOf(members[0]!.config.motion) };
  });

  // The pose cache: a ring of Ticks × bodies, flushed by a new clock.
  const n = bodies.length;
  const ring = BOT_LOOK_AHEAD_TICKS_MAX + 2;
  const stamps = new Float64Array(ring * n).fill(Number.NaN);
  const poses: MotionPose[] = new Array<MotionPose>(ring * n);
  let cachedClock: MotionClock | undefined;
  const moves = bodies.map((b) => originMoves(b.config));
  // Where each body's origin rests, and the furthest it ever strays from there (M17 ticket 07i): `near`
  // rejects a far body with one hypot against these instead of walking its origin over the look window
  // (Spin Cycle's 68 sweepers cost `SweeperHold` 107 µs a decision that way). Exact for a body posed by
  // one periodic Motion of its own, whose origin's path is the one cycle at pace 1 sampled here, plus a
  // Tick's step for the phases a Ramp lands between samples; any other body (a chain of Motions, a trap
  // door, a glove) keeps the walk.
  const rests = bodies.map((b) => movingSegmentPose(b.config, 0, null).position);
  const strays = bodies.map((b, i) => {
    if (!moves[i]) return 0;
    const { motion, under, trapDoor, punch } = b.config;
    const kinds = [motion.spin, motion.swing, motion.slide].filter((m) => m !== undefined).length;
    if (kinds !== 1 || under !== undefined || trapDoor !== undefined || punch !== undefined) return Number.POSITIVE_INFINITY;
    const rest = rests[i]!;
    let stray = 0;
    let step = 0;
    let previous = rest;
    for (let tick = 1; tick <= periodTicksOf(motion) + 1; tick += 1) {
      const p = movingSegmentPose(b.config, tick, null).position;
      stray = Math.max(stray, Math.hypot(p.x - rest.x, p.y - rest.y, p.z - rest.z));
      step = Math.max(step, Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z));
      previous = p;
    }
    return stray + step;
  });
  const poseAt = (i: number, tick: number, clock: MotionClock): MotionPose => {
    if (clock !== cachedClock) {
      cachedClock = clock;
      stamps.fill(Number.NaN);
    }
    const slot = (((tick % ring) + ring) % ring) * n + i;
    if (stamps[slot] !== tick) {
      poses[slot] = movingSegmentPose(bodies[i]!.config, tick, clock);
      stamps[slot] = tick;
    }
    return poses[slot]!;
  };
  const fragileRow = (segmentIndex: number, rows: readonly Readonly<FragileState>[] | undefined): Readonly<FragileState> | undefined =>
    rows === undefined ? undefined : rows.find((row) => row.segmentIndex === segmentIndex);

  // Which polygons each fragile block owns, and what was last applied to them.
  const polysOf = new Map<number, number[]>();
  let polysFor: TrackNav | null = null;
  const applied = new Map<number, number>();

  const occupies: MovingWorld["occupies"] = (i, tick, clock, p, grow) => {
    const local = unapply(poseAt(i, tick, clock), p);
    const yLo = local.y - CAPSULE_BOTTOM_OFFSET;
    const yHi = local.y + CAPSULE_BOTTOM_OFFSET;
    for (const h of bodies[i]!.hitboxes) {
      if (yHi < h.yMin || yLo > h.yMax) continue;
      const dx = local.x - h.cx;
      const dz = local.z - h.cz;
      const c = Math.cos(h.yaw);
      const s = Math.sin(h.yaw);
      const u = dx * c + dz * s;
      const v = -dx * s + dz * c;
      if (Math.abs(u) <= h.hx + grow && Math.abs(v) <= h.hz + grow) return true;
    }
    return false;
  };

  // A cross (M17 ticket 07i, round 3): a sweeper spinning about its own fixed origin whose longest gap
  // between arms, at the best of eight points on a ring inside its swath, is shorter than a walk
  // across the swath. Asked once per world, off the clock, with the hold's own margin.
  // Two bars on one axle at one speed are one cross (Spin Cycle's 33/34): each alone has a window, together they have none.
  const grow = CAPSULE_RADIUS + BOT_HOLD_MARGIN_M;
  const spinKey = (body: MovingBody): string | null => {
    const { motion, under, trapDoor, punch } = body.config;
    if (motion.spin === undefined || motion.spin.speed === 0 || motion.swing !== undefined || motion.slide !== undefined) return null;
    if ((under !== undefined && under.length > 0) || trapDoor !== undefined || punch !== undefined || moves[body.index]) return null;
    return `${axisLineKey(body.config, motion.spin.axis, motion.spin.pivot)}:${motion.spin.speed}`;
  };
  const axles = new Map<string, MovingBody[]>();
  for (const body of sweepers) {
    const key = spinKey(body);
    if (key === null) continue;
    const group = axles.get(key);
    if (group === undefined) axles.set(key, [body]);
    else group.push(body);
  }
  const isCross = (group: readonly MovingBody[]): boolean => {
    const first = group[0]!;
    const period = periodTicksOf(first.config.motion);
    if (period < 2) return false;
    const radius = group.reduce((r, b) => Math.max(r, b.radius), 0);
    const crossing = Math.ceil((2 * (radius + grow)) / WALK_SPEED / TICK_DT);
    const rest = rests[first.index]!;
    const r = BOT_CROSS_PROBE_RADIUS_SHARE * radius;
    let bestGap = 0;
    for (let k = 0; k < 8 && bestGap < crossing; k += 1) {
      const angle = (k / 8) * 2 * Math.PI;
      const p = { x: rest.x + r * Math.cos(angle), y: rest.y, z: rest.z + r * Math.sin(angle) };
      // The longest free run over one turn, the turn read twice so a run across the seam counts whole.
      let run = 0;
      let gap = 0;
      for (let tick = 0; tick < 2 * period; tick += 1) {
        if (group.some((b) => occupies(b.index, tick % period, null, p, grow))) run = 0;
        else gap = Math.max(gap, (run += 1));
      }
      bestGap = Math.max(bestGap, Math.min(gap, period));
    }
    return bestGap < crossing;
  };
  const crosses: MovingBody[] = [];
  for (const group of axles.values()) if (isCross(group)) crosses.push(...group);
  markCrossSwaths(nav, crosses, rests, grow);

  return {
    bodies,
    floors,
    sweepers,
    gates,
    fragile,
    platforms,
    crosses,
    poseAt,
    velocityAt: (i, tick, clock, p) => {
      const local = unapply(poseAt(i, tick, clock), p);
      const next = apply(poseAt(i, tick + 1, clock), local);
      return { x: (next.x - p.x) / TICK_DT, y: (next.y - p.y) / TICK_DT, z: (next.z - p.z) / TICK_DT };
    },
    solidAt: (i, tick, rows) => {
      const { config } = bodies[i]!;
      if (config.trapDoor !== undefined) return trapDoorShut(config.trapDoor, tick);
      if (config.punch !== undefined) return punchLanded(config.punch.cycle, tick);
      if (config.fragile !== undefined) {
        const row = fragileRow(config.segmentIndex, rows);
        return row === undefined || fragileStanding(config.fragile, row.hits);
      }
      return true;
    },
    occupies,
    near: (p, reach, tick, window, clock, roles) => {
      const out: MovingBody[] = [];
      for (const body of bodies) {
        if (roles !== undefined && !roles.includes(body.role)) continue;
        const within = body.radius + reach;
        const rest = rests[body.index]!;
        if (Math.hypot(rest.x - p.x, rest.y - p.y, rest.z - p.z) > within + strays[body.index]!) continue;
        const at = poseAt(body.index, tick, clock).position;
        if (Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z) <= within) {
          out.push(body);
          continue;
        }
        if (!moves[body.index]) continue;
        for (let t = tick + 1; t <= tick + window; t += 1) {
          const q = poseAt(body.index, t, clock).position;
          if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= within) {
            out.push(body);
            break;
          }
        }
      }
      return out;
    },
    platformUnder: (p, tick, clock, below = NAV_AGENT_CLIMB) => {
      for (const platform of platforms) {
        const local = unapply(poseAt(platform.bodies[0]!.index, tick, clock), p);
        const dy = local.y - CAPSULE_BOTTOM_OFFSET - platform.deck.y;
        if (dy > NAV_AGENT_CLIMB || dy < -below) continue;
        if (inHull(platform.deck.hull, local)) return platform;
      }
      return null;
    },
    toLocal: (platform, tick, clock, p) => unapply(poseAt(platform.bodies[0]!.index, tick, clock), p),
    toWorld: (platform, tick, clock, local) => apply(poseAt(platform.bodies[0]!.index, tick, clock), local),
    syncFragile: (nav, rows) => {
      if (fragile.length === 0 || nav.gated === undefined) return;
      if (polysFor !== nav) {
        polysFor = nav;
        polysOf.clear();
        applied.clear();
        for (const [ref, segmentIndex] of nav.gated) {
          const list = polysOf.get(segmentIndex);
          if (list === undefined) polysOf.set(segmentIndex, [ref]);
          else list.push(ref);
        }
      }
      for (const body of fragile) {
        const def = body.config.fragile!;
        const row = fragileRow(body.config.segmentIndex, rows);
        const hits = row?.hits ?? 0;
        const want = !fragileStanding(def, hits) ? BROKEN_FLAG : hits === def.entries - 1 ? LAST_CRACK_FLAG : 0;
        if ((applied.get(body.config.segmentIndex) ?? 0) === want) continue;
        applied.set(body.config.segmentIndex, want);
        for (const ref of polysOf.get(body.config.segmentIndex) ?? []) {
          nav.navMesh.setPolyFlags(ref, (nav.navMesh.getPolyFlags(ref).flags & ~FRAGILE_FLAGS) | want);
        }
      }
    },
  };
};
