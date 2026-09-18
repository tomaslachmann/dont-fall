import {
  addVec3,
  applyMotionPose,
  conjugateQuat,
  motionPose,
  rotateVec3ByQuat,
  scaleVec3,
  subVec3,
  type DeckFrame,
  type DeckPlan,
  type Quat,
  type SegmentMotion,
  type Vec3,
} from "@dont-fall/shared";
import { deckPlanOutline } from "../deckSheet.js";
import {
  MUD_BLOTCH_SIZE,
  MUD_BUBBLE_CHANCE,
  MUD_BUBBLE_INSET,
  MUD_BUBBLE_PERIOD_MAX,
  MUD_BUBBLE_PERIOD_MIN,
  MUD_BUBBLE_RADIUS_MAX,
  MUD_BUBBLE_RADIUS_MIN,
  MUD_BUBBLE_SPACING,
  MUD_CLOD_BLEND,
  MUD_CLOD_HEIGHT_MAX,
  MUD_CLOD_HEIGHT_MIN,
  MUD_CLOD_RADIUS_MAX,
  MUD_CLOD_RADIUS_MIN,
  MUD_CLOD_SPACING,
  MUD_COLOR_BASE,
  MUD_COLOR_CREST,
  MUD_COLOR_DARK,
  MUD_COLOR_DEEP,
  MUD_COLOR_LIGHT,
  MUD_DEPTH,
  MUD_SWELL_HEIGHT,
  MUD_SWELL_SIZE,
} from "./mudLook.js";

/**
 * The shape of a mud deck (ADR 0103), as pure functions of where you are on it
 * — no three.js here, so the game and the Track builder cut the same mud and a
 * test can read it.
 *
 * Everything is in the deck's own frame (x/z across it from its centre, as a
 * `DeckPlan` is), except the noise, which is sampled in **world** space: two
 * mud decks laid side by side therefore grow the same clods along the line
 * they share, and a lane of mud reads as one mass rather than a row of tiles.
 */

type Point = { x: number; z: number };

/** A mud deck as the shape needs it: its frame, and where a point on it goes when its Segment moves. */
export interface MudDeckPlacement {
  deck: DeckFrame;
  /** Where a world point on this deck at rest is at `tick` — absent for a deck that never moves. */
  carry?: (point: Vec3, tick: number) => Vec3;
}

/** `carry` for a Segment placed at `position`/`orientation`/`scale` running `motion` — what both renderers hand {@link MudDeckPlacement}. */
export const motionCarry =
  (position: Vec3, orientation: Quat, scale: number, motion: SegmentMotion) =>
  (point: Vec3, tick: number): Vec3 => {
    const local = scaleVec3(rotateVec3ByQuat(subVec3(point, position), conjugateQuat(orientation)), 1 / scale);
    return addVec3(position, rotateVec3ByQuat(scaleVec3(applyMotionPose(motionPose(motion, tick), local), scale), orientation));
  };

/** One edge of a mud deck's outline, and whether mud stops there (`free`) or runs on into a neighbouring mud deck. */
export interface MudEdge {
  a: Point;
  b: Point;
  free: boolean;
}

/** The deck's own frame to the world, at rest. */
export const deckToWorld = (deck: DeckFrame, p: { x: number; y?: number; z: number }): Vec3 =>
  addVec3(deck.center, rotateVec3ByQuat({ x: p.x, y: p.y ?? 0, z: p.z }, deck.orientation));

const toDeck = (deck: DeckFrame, p: Vec3): Vec3 => rotateVec3ByQuat(subVec3(p, deck.center), conjugateQuat(deck.orientation));

const cross2 = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Whether `p` (deck frame) is on the deck's walking surface, allowing `pad` metres of slack. */
export const isOnDeck = (deck: DeckFrame, p: Point, pad: number): boolean => {
  if (Math.abs(p.x) > deck.halfX + pad || Math.abs(p.z) > deck.halfZ + pad) return false;
  const plan = deck.plan;
  if (!plan) return true;
  for (let t = 0; t + 2 < plan.indices.length; t += 3) {
    const a = plan.vertices[plan.indices[t]!]!;
    const b = plan.vertices[plan.indices[t + 1]!]!;
    const c = plan.vertices[plan.indices[t + 2]!]!;
    const sign = Math.sign(cross2(a, b, c)) || 1;
    // Signed distance from each edge, inward positive — inside with slack when none is below −pad.
    const inside = [
      [a, b],
      [b, c],
      [c, a],
    ].every(([p0, p1]) => (sign * cross2(p0!, p1!, p)) / (Math.hypot(p1!.x - p0!.x, p1!.z - p0!.z) || 1) >= -pad);
    if (inside) return true;
  }
  return false;
};

/** The deck's outline, as edges in its own frame: the plan's, or the footprint rectangle's four sides. */
const outline = (deck: DeckFrame): [Point, Point][] => {
  if (deck.plan) return deckPlanOutline(deck.plan).map(([a, b]) => [deck.plan!.vertices[a]!, deck.plan!.vertices[b]!]);
  const { halfX: x, halfZ: z } = deck;
  return [
    [{ x: -x, z: -z }, { x, z: -z }],
    [{ x, z: -z }, { x, z }],
    [{ x, z }, { x: -x, z }],
    [{ x: -x, z }, { x: -x, z: -z }],
  ];
};

/**
 * How far in from its footprint a deck's walking surface stops: a KayKit
 * piece's bevelled edge — a 45° chamfer on every piece this game places, so
 * as deep as it is wide. Capped, so a deck whose top face is a small part of
 * its footprint never reads as all bevel.
 */
export const mudBevel = (deck: DeckFrame): number => {
  if (!deck.plan) return 0;
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const v of deck.plan.vertices) {
    [minX, maxX, minZ, maxZ] = [Math.min(minX, v.x), Math.max(maxX, v.x), Math.min(minZ, v.z), Math.max(maxZ, v.z)];
  }
  const gap = Math.max(deck.halfX - maxX, minX + deck.halfX, deck.halfZ - maxZ, minZ + deck.halfZ);
  return Math.max(0, Math.min(gap, 0.12 * Math.min(deck.halfX, deck.halfZ)));
};

/** How far past an edge the neighbour test looks, and the slack it allows. */
const SEAM_REACH = 0.03;
const SEAM_SLACK = 0.01;

const covered = new WeakMap<DeckFrame, DeckFrame>();

/**
 * The deck a mud mass covers: the walking surface grown out over its own
 * bevel, never past its footprint — the whole piece as seen from above (the
 * user, 2026-09-18: "přes ten zohnutý okraj bloku, ať můžeme navazovat mud
 * vedle sebe"). Two KayKit pieces laid edge to edge are two bevels apart at
 * the top; covered like this they touch, so the mud on one runs on into the
 * other, and where it stops its cut side hides the bevel.
 */
export const mudCoverage = (deck: DeckFrame): DeckFrame => {
  const cached = covered.get(deck);
  if (cached) return cached;
  const bevel = mudBevel(deck);
  const plan = deck.plan;
  if (!plan || bevel === 0) {
    covered.set(deck, deck);
    return deck;
  }
  // Every outline vertex moves out along the mitre of its two edges' normals:
  // parallel edges by the bevel, a square corner by the bevel along both.
  const push = plan.vertices.map(() => ({ n: [] as Point[] }));
  for (const [ia, ib] of deckPlanOutline(plan)) {
    const [a, b] = [plan.vertices[ia]!, plan.vertices[ib]!];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const normal = { x: (b.z - a.z) / length, z: -(b.x - a.x) / length };
    const sign = [1, -1].find((s) => !isOnDeck(deck, { x: mid.x + normal.x * s * SEAM_REACH, z: mid.z + normal.z * s * SEAM_REACH }, 0));
    if (sign === undefined) continue;
    for (const i of [ia, ib]) push[i]!.n.push({ x: normal.x * sign, z: normal.z * sign });
  }
  const vertices = plan.vertices.map((v, i) => {
    const [n1, n2 = n1] = push[i]!.n;
    if (!n1) return v;
    const scale = bevel / Math.max(0.5, 1 + n1.x * n2!.x + n1.z * n2!.z);
    return {
      x: Math.min(deck.halfX, Math.max(-deck.halfX, v.x + (n1.x + n2!.x) * scale)),
      z: Math.min(deck.halfZ, Math.max(-deck.halfZ, v.z + (n1.z + n2!.z) * scale)),
    };
  });
  const grown = { ...deck, plan: { vertices, indices: plan.indices } };
  covered.set(deck, grown);
  return grown;
};

/** Ticks at which two decks must be in the same place to count as moving together — irregular, so no cycle lines up by accident. */
const SEAM_TICKS = [0, 7, 23, 61, 150, 377];
/** How close two deck tops must sit to count as one surface. */
const SEAM_HEIGHT = 0.05;

const movesWith = (self: MudDeckPlacement, other: MudDeckPlacement, point: Vec3): boolean =>
  SEAM_TICKS.every((tick) => {
    const mine = self.carry ? self.carry(point, tick) : point;
    const theirs = other.carry ? other.carry(point, tick) : point;
    return Math.hypot(mine.x - theirs.x, mine.y - theirs.y, mine.z - theirs.z) < SEAM_SLACK;
  });

/**
 * The outline of `self`'s mud ({@link mudCoverage}), each edge marked free or
 * shared. At a free edge the mud is cut square. An edge is shared when just
 * past it lies another mud deck's mud — at the same height and moving with
 * this one — so the mud runs on across the seam instead of being cut there
 * too. Four quarter circles inside four quarter curves are one disc of mud
 * this way, and a disc that spins spins as one.
 */
export const mudOutline = (self: MudDeckPlacement, others: readonly MudDeckPlacement[]): MudEdge[] => {
  const mine = mudCoverage(self.deck);
  return outline(mine).map(([a, b]) => {
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const normal = { x: (b.z - a.z) / length, z: -(b.x - a.x) / length };
    // Which side is out is not a property of the edge (a plan can wrap a hole
    // either way round), so it is the side that is not this deck.
    const out = [1, -1]
      .map((s) => ({ x: mid.x + normal.x * s * SEAM_REACH, z: mid.z + normal.z * s * SEAM_REACH }))
      .find((p) => !isOnDeck(mine, p, 0));
    if (!out) return { a, b, free: true };
    const worldOut = deckToWorld(mine, out);
    const worldMid = deckToWorld(mine, mid);
    const shared = others.some((other) => {
      if (other === self) return false;
      const there = toDeck(other.deck, worldOut);
      if (Math.abs(there.y) > SEAM_HEIGHT || !isOnDeck(mudCoverage(other.deck), there, SEAM_SLACK)) return false;
      return movesWith(self, other, worldMid);
    });
    return { a, b, free: !shared };
  });
};

// --- The field ---------------------------------------------------------------

/** Quintic fade: no crease along a lattice line. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

const hash = (ix: number, iz: number, seed: number): number => {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
};

/**
 * Smooth value noise in [-1, 1] over the whole plane — unbounded and
 * untiled, since it is sampled at world positions. The domain is turned off
 * the axes so its lattice never lines up with a deck's edges.
 */
export const mudNoise = (x: number, z: number, seed: number): number => {
  const u = x * 0.8776 - z * 0.4794;
  const v = x * 0.4794 + z * 0.8776;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = fade(u - iu);
  const fv = fade(v - iv);
  const a = hash(iu, iv, seed);
  const b = hash(iu + 1, iv, seed);
  const c = hash(iu, iv + 1, seed);
  const d = hash(iu + 1, iv + 1, seed);
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
};

const smoothstep = (from: number, to: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Polynomial smooth maximum: `max(a, b)` with the corner rounded over `k`. */
const smoothMax = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
};

const SWELL_SEED = 11;
const CLOD_SEED = 29;
const BLOTCH_SEED = 53;
const BUBBLE_SEED = 71;

/** A hash in [0, 1) — {@link hash} folded up from [-1, 1). */
const unit = (ix: number, iz: number, seed: number): number => (hash(ix, iz, seed) + 1) / 2;

/**
 * The clods at a world point, in metres above the mud between them: soft
 * domes on a jittered world grid, each its own width and height, merged by a
 * smooth maximum so two that meet run into one another like dollops of
 * something thick. The grid is turned off the axes, like {@link mudNoise},
 * so rows of clods never line up with a deck's edge.
 */
export const mudClods = (wx: number, wz: number): number => {
  const u = (wx * 0.8776 - wz * 0.4794) / MUD_CLOD_SPACING;
  const v = (wx * 0.4794 + wz * 0.8776) / MUD_CLOD_SPACING;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  let height = 0;
  for (let du = -1; du <= 1; du += 1) {
    for (let dv = -1; dv <= 1; dv += 1) {
      const cu = iu + du;
      const cv = iv + dv;
      const x = cu + 0.5 + 0.35 * hash(cu, cv, CLOD_SEED);
      const z = cv + 0.5 + 0.35 * hash(cu, cv, CLOD_SEED + 1);
      const radius = (MUD_CLOD_RADIUS_MIN + (MUD_CLOD_RADIUS_MAX - MUD_CLOD_RADIUS_MIN) * unit(cu, cv, CLOD_SEED + 2)) / MUD_CLOD_SPACING;
      const reach = 1 - ((u - x) ** 2 + (v - z) ** 2) / (radius * radius);
      if (reach <= 0) continue;
      const top = MUD_CLOD_HEIGHT_MIN + (MUD_CLOD_HEIGHT_MAX - MUD_CLOD_HEIGHT_MIN) * unit(cu, cv, CLOD_SEED + 3);
      height = smoothMax(height, top * reach * reach, MUD_CLOD_BLEND);
    }
  }
  return height;
};

/**
 * Height of the mud above its deck at world `wx`/`wz`: the mass, a slow swell,
 * and the clods heaped on it. The same everywhere on a deck, its edge
 * included — the mud is cut square there, not rolled off — and sampled in the
 * world, so two decks meeting at a seam meet at one height.
 */
export const mudHeight = (wx: number, wz: number): number =>
  MUD_DEPTH + MUD_SWELL_HEIGHT * mudNoise(wx / MUD_SWELL_SIZE, wz / MUD_SWELL_SIZE, SWELL_SEED) + mudClods(wx, wz);

/** The highest the mud ever stands — the reach a foot has to clear to be jumping over it. */
export const MUD_TOP = MUD_DEPTH + MUD_SWELL_HEIGHT + MUD_CLOD_HEIGHT_MAX + MUD_CLOD_BLEND / 4;

/** Linear RGB in 0–1, mixed in sRGB hex space like a painter would; the caller converts. */
export type Rgb = [number, number, number];

const rgb = (hex: number): Rgb => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const DEEP = rgb(MUD_COLOR_DEEP);
const DARK = rgb(MUD_COLOR_DARK);
const BASE = rgb(MUD_COLOR_BASE);
const LIGHT = rgb(MUD_COLOR_LIGHT);
const CREST = rgb(MUD_COLOR_CREST);

/**
 * The painted colour at a world point (sRGB, 0–1): broad blotches in three
 * tones, each clod's crest caught caramel, and the creases between clods
 * sunk a shade deeper — the shading a toy's mud is painted with, on top of
 * whatever the light does.
 */
export const mudColor = (wx: number, wz: number): Rgb => {
  const blotch = mudNoise(wx / MUD_BLOTCH_SIZE, wz / MUD_BLOTCH_SIZE, BLOTCH_SEED);
  let colour = mixRgb(DARK, BASE, smoothstep(-0.45, -0.1, blotch));
  colour = mixRgb(colour, LIGHT, 0.6 * smoothstep(0.25, 0.55, blotch));
  const clod = mudClods(wx, wz) / MUD_CLOD_HEIGHT_MAX;
  colour = mixRgb(colour, CREST, 0.75 * smoothstep(0.45, 1, clod));
  return mixRgb(colour, DEEP, 0.45 * (1 - smoothstep(0, 0.3, clod)));
};

/** Where a bubble rises on a deck, in the deck's own frame, and its rhythm. */
export interface MudBubbleSite {
  x: number;
  z: number;
  /** The mud's resting height there — where the bubble breaks the surface. */
  y: number;
  radius: number;
  /** Seconds from one bubble to the next. */
  period: number;
  /** Where in its cycle this spot starts, 0–1 — so neighbouring spots never pop together. */
  phase: number;
}

/**
 * The spots a deck's mud bubbles at: a grid across the deck (its
 * {@link mudCoverage}, as the mass is), a share of its cells holding one,
 * jittered inside its cell, and never within {@link MUD_BUBBLE_INSET} of a
 * free edge. Seeded by where the deck is, so the
 * game and the Track builder bubble in the same places and two identical
 * decks side by side do not bubble in step.
 */
export const mudBubbleSites = (deck: DeckFrame, edges: readonly MudEdge[]): MudBubbleSite[] => {
  const seed = BUBBLE_SEED + Math.round(deck.center.x * 7) * 131 + Math.round(deck.center.z * 7) * 17 + Math.round(deck.center.y * 7);
  const nx = Math.max(1, Math.round((2 * deck.halfX) / MUD_BUBBLE_SPACING));
  const nz = Math.max(1, Math.round((2 * deck.halfZ) / MUD_BUBBLE_SPACING));
  const cellX = (2 * deck.halfX) / nx;
  const cellZ = (2 * deck.halfZ) / nz;
  const sites: MudBubbleSite[] = [];
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      if (unit(i, j, seed) >= MUD_BUBBLE_CHANCE) continue;
      const p = {
        x: -deck.halfX + (i + 0.5 + 0.35 * hash(i, j, seed + 1)) * cellX,
        z: -deck.halfZ + (j + 0.5 + 0.35 * hash(i, j, seed + 2)) * cellZ,
      };
      if (!isOnDeck(deck, p, 0) || nearestFreeEdge(p, edges).distance < MUD_BUBBLE_INSET) continue;
      const world = deckToWorld(deck, p);
      sites.push({
        ...p,
        y: mudHeight(world.x, world.z),
        radius: MUD_BUBBLE_RADIUS_MIN + (MUD_BUBBLE_RADIUS_MAX - MUD_BUBBLE_RADIUS_MIN) * unit(i, j, seed + 3),
        period: MUD_BUBBLE_PERIOD_MIN + (MUD_BUBBLE_PERIOD_MAX - MUD_BUBBLE_PERIOD_MIN) * unit(i, j, seed + 4),
        phase: unit(i, j, seed + 5),
      });
    }
  }
  return sites;
};

/** Distance from `p` to the segment `a`–`b`. */
export const distanceToEdge = (p: Point, a: Point, b: Point): number => {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const lengthSq = ex * ex + ez * ez;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.z - a.z) * ez) / lengthSq));
  return Math.hypot(p.x - (a.x + ex * t), p.z - (a.z + ez * t));
};

/** The nearest free edge to `p` and how far it is — `Infinity` and `-1` on a deck whose every edge runs on into mud. */
export const nearestFreeEdge = (p: Point, edges: readonly MudEdge[]): { distance: number; index: number } => {
  let distance = Infinity;
  let index = -1;
  for (const [i, edge] of edges.entries()) {
    if (!edge.free) continue;
    const d = distanceToEdge(p, edge.a, edge.b);
    if (d < distance) {
      distance = d;
      index = i;
    }
  }
  return { distance, index };
};

/** A plan's triangles as point triples, or the rectangle's two — the region every mud mesh is cut to. */
export const deckRegion = (deck: Pick<DeckFrame, "halfX" | "halfZ" | "plan">): [Point, Point, Point][] => {
  const plan: DeckPlan | undefined = deck.plan;
  if (plan) {
    const out: [Point, Point, Point][] = [];
    for (let t = 0; t + 2 < plan.indices.length; t += 3) {
      out.push([plan.vertices[plan.indices[t]!]!, plan.vertices[plan.indices[t + 1]!]!, plan.vertices[plan.indices[t + 2]!]!]);
    }
    return out;
  }
  const { halfX: x, halfZ: z } = deck;
  return [
    [{ x: -x, z: -z }, { x, z: -z }, { x, z }],
    [{ x: -x, z: -z }, { x, z }, { x: -x, z }],
  ];
};
