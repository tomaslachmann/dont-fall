import RAPIER from "@dimforge/rapier3d-compat";
import { IDENTITY_QUAT } from "../math/quat.js";
import { rotateVec3ByQuat, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { isDownMotionState } from "../simulation/CharacterStateMachine.js";
import { RapierSimulation } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS } from "../simulation/SimInputs.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { BOUNCE_SURFACE_ID } from "../track/BounceOverlay.js";
import { DEFAULT_SURFACE, surfaceConfig, type SurfaceId } from "../track/Surface.js";
import {
  BOT_CORNER_REACHED_M,
  BOT_HOP_SAFE_RUN_MIN,
  BOT_LINK_ATTEMPTS_PER_PAIR,
  BOT_LINK_FACING_MAX_DEG,
  BOT_LINK_MAX_DROP_M,
  BOT_LINK_MAX_TICKS,
  BOT_LINK_MIN_SAVING_M,
  BOT_LINK_RUNUP_M,
  BOT_LINK_SAMPLE_M,
  BOT_LINK_SPACING_M,
  BOT_LINK_START_ALONG_M,
  BOT_LINK_START_SIDE_M,
  BOT_STALE_TICKS_MAX,
  NAV_AGENT_RADIUS,
} from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, WALL_NORMAL_MAX_Y } from "../tuning/character.js";
import { JUMP_HOLD_MAX_TICKS, WALKABLE_SLOPE_MAX_ANGLE } from "../tuning/movement.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
import { hopSafeRun, LinkRun, type HopState, type LinkHop, type LinkRecipe, type LinkScriptStep, type NavLink, type NavLinkKind } from "./links.js";
import type { BotStillWorld, NavInput } from "./navInput.js";
import { navPath, navStandsOn, navSurfaceAt, type TrackNav } from "./navMesh.js";

/*
 * Proving the links a navmesh cannot see (M17 ticket 05, ADR 0129). Nothing
 * here is a formula for where a jump lands: every link is played in a scratch
 * `RapierSimulation` of the Track's still geometry, from where it starts, with
 * the input a Bot will give it (`LinkRun`), and kept only where it landed and
 * stood on the navmesh somewhere a walk does not already reach.
 *
 * What is played is only what is still: boxes, Asset trimeshes, belts,
 * Springs, launch pads and Volumes. Moving Segments, trap doors, fragile
 * floors, Props and Spinners are left out, as the navmesh leaves them out
 * (`trackNavInput`): a Bot reads those at the Tick, and ticket 07 times them.
 */

const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

// --- The jump, measured -----------------------------------------------------

/** One Tick of a measured jump: how far it has carried, and where the feet are against where they left the ground. */
interface JumpSample {
  distance: number;
  height: number;
}

/** A jump off a Surface as it was played: its path through the air, and the highest it rose. */
interface JumpEnvelope {
  samples: readonly JumpSample[];
  rise: number;
}

const envelopes = new Map<SurfaceId, JumpEnvelope>();

const MEASURE_ID = "measure";

/** A deck long enough for any Surface to reach its top speed on, ending in a drop deeper than a link may land. */
const MEASURE_DECK_HALF_LENGTH = 40;

/**
 * The jump off `surface`, measured by playing one (M17 ticket 05): a capsule
 * runs the length of a deck of that Surface and jumps off its end, holding
 * jump through the boost, and its path is recorded until it is further down
 * than any link lands. The reach a link is looked for within comes from this,
 * so it follows the jump's tuning (and each Surface's `jumpMultiplier`)
 * without a number of its own. Kept per process: it depends on nothing but
 * the tuning.
 *
 * A bounce deck is played as a Bot takes off from one ({@link bounceRecipes}):
 * a capsule on it never stops hopping (any landing rebounds at the deck's
 * `minSpeed` at least), so it is put down near the end and jumps on the first
 * Tick it lands, which is when the deck's rebound and the jump combine.
 */
const jumpEnvelope = (surface: SurfaceId): JumpEnvelope => {
  const known = envelopes.get(surface);
  if (known !== undefined) return known;
  const deck = { center: vec3(0, -0.5, 0), halfExtents: vec3(2, 0.5, MEASURE_DECK_HALF_LENGTH) };
  const sim = new RapierSimulation({
    statics: [deck],
    staticSurfaces: [surface],
    withDefaultCharacter: false,
    authoritative: false,
    killPlaneY: -BOT_LINK_MAX_DROP_M - 4,
  });
  const edge = -MEASURE_DECK_HALF_LENGTH;
  const hops = surfaceConfig(surface).bounce !== undefined;
  const startZ = hops ? edge + BOT_LINK_RUNUP_M : MEASURE_DECK_HALF_LENGTH - 1;
  sim.addCharacter(MEASURE_ID, vec3(0, CAPSULE_BOTTOM_OFFSET + 0.05, startZ));
  const run = { ...IDLE_INPUTS, moveDirection: vec3(0, 0, -1) };
  const samples: JumpSample[] = [];
  let takeOff: Vec3 | null = null;
  let held = 0;
  try {
    for (let tick = 0; tick < 60 * 30; tick += 1) {
      const self = sim.snapshot().characters[MEASURE_ID]!;
      if (takeOff === null && self.grounded && (hops || self.position.z <= edge + BOT_CORNER_REACHED_M)) {
        takeOff = self.position;
        held = JUMP_HOLD_MAX_TICKS + 1;
      }
      if (takeOff !== null) {
        const height = self.position.y - takeOff.y;
        samples.push({ distance: groundDistance(takeOff, self.position), height });
        if (height < -BOT_LINK_MAX_DROP_M || self.fallCount > 0) break;
      }
      sim.tick({ [MEASURE_ID]: { ...run, jumpHeld: held > 0 } });
      if (held > 0) held -= 1;
    }
  } finally {
    sim.dispose();
  }
  const envelope = { samples, rise: Math.max(0, ...samples.map((sample) => sample.height)) };
  envelopes.set(surface, envelope);
  return envelope;
};

/** How far a jump carries before its feet drop below `height` against the take-off: the last point of its path at or above it. */
const reachAt = (envelope: JumpEnvelope, height: number): number => {
  let reach = 0;
  for (const sample of envelope.samples) if (sample.height >= height) reach = Math.max(reach, sample.distance);
  return reach;
};

// --- The navmesh's borders --------------------------------------------------

/** A point on the edge of the navmesh, facing out of it. */
interface BorderSample {
  point: Vec3;
  /** Out of the navmesh, a unit vector on the ground. */
  normal: Vec3;
  /** Which walkable place it is on: the polygons joined to its own. */
  place: number;
  surface: SurfaceId;
}

/** Detour's flag on a polygon edge's neighbour that joins another tile. A solo navmesh has none. */
const EXT_LINK = 0x8000;

/**
 * Every border of the navmesh, sampled every {@link BOT_LINK_SAMPLE_M}, and
 * which place (connected set of polygons) each lies on. Read straight off
 * Detour's one tile: an edge with no neighbour is a border.
 */
const borderSamples = (nav: TrackNav): BorderSample[] => {
  const { navMesh } = nav;
  const tile = navMesh.getTile(0);
  const header = tile.header();
  if (header === null) return [];
  const count = header.polyCount();
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const vertex = (index: number): Vec3 => vec3(tile.verts(index * 3), tile.verts(index * 3 + 1), tile.verts(index * 3 + 2));
  const edges: { poly: number; a: Vec3; b: Vec3; centre: Vec3 }[] = [];
  const areas: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const poly = tile.polys(i);
    areas.push(poly.areaAndType() & 0x3f);
    if (poly.getType() !== 0) continue;
    const n = poly.vertCount();
    const corners = Array.from({ length: n }, (_, k) => vertex(poly.verts(k)));
    const centre = vec3(
      corners.reduce((sum, c) => sum + c.x, 0) / n,
      corners.reduce((sum, c) => sum + c.y, 0) / n,
      corners.reduce((sum, c) => sum + c.z, 0) / n,
    );
    for (let k = 0; k < n; k += 1) {
      const neighbour = poly.neis(k);
      if (neighbour === 0) edges.push({ poly: i, a: corners[k]!, b: corners[(k + 1) % n]!, centre });
      else if ((neighbour & EXT_LINK) === 0) parent[find(i)] = find(neighbour - 1);
    }
  }
  const samples: BorderSample[] = [];
  for (const { poly, a, b, centre } of edges) {
    const length = groundDistance(a, b);
    if (length === 0) continue;
    // Perpendicular to the edge, on the side away from its polygon's middle.
    let nx = -(b.z - a.z) / length;
    let nz = (b.x - a.x) / length;
    const mid = vec3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    if ((centre.x - mid.x) * nx + (centre.z - mid.z) * nz > 0) {
      nx = -nx;
      nz = -nz;
    }
    const steps = Math.max(1, Math.round(length / BOT_LINK_SAMPLE_M));
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      samples.push({
        point: vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
        normal: vec3(nx, 0, nz),
        place: find(poly),
        surface: nav.surfaces[areas[poly]!] ?? DEFAULT_SURFACE,
      });
    }
  }
  return samples;
};

// --- Is the air clear? ------------------------------------------------------

/**
 * The Track's still geometry as a query-only Rapier world (M17 ticket 05):
 * before a jump is played, a capsule a little smaller than a Character's is
 * swept along the measured jump's path, and a jump that would meet something
 * on the way (a post, a fence, a bar at rest, the side of a tier too high) is
 * not played. It only ever lets a candidate go: it never decides where a jump
 * lands. Without it most of what was played on Spin Cycle was a capsule
 * stopped by the first post or railing in its way and landing back where it
 * started (measured at rest: 5,961 plays and 146 s for 220 links; with it,
 * 817 plays and 1.8 s).
 */
/**
 * The Track's still geometry as a query-only Rapier world, ready to ask: every
 * box and Asset trimesh, fixed, stepped once so they are in its query
 * structures. For the jump's clearance sweep (M17 ticket 05) and the ground
 * probe that tells a drop from a wall (ticket 06). Its caller frees it.
 * `hazards`, when given, is filled with the handles of the hazard pieces'
 * colliders (M17 ticket 06b).
 */
export const stillQueryWorld = (resolved: Pick<BotStillWorld, "statics" | "staticTrimeshes">, hazards?: Set<number>): RAPIER.World => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  for (const box of resolved.statics) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z),
      world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(box.center.x, box.center.y, box.center.z).setRotation(box.rotation ?? IDENTITY_QUAT)),
    );
  }
  for (const mesh of resolved.staticTrimeshes) {
    const vertices = new Float32Array(mesh.vertices.flatMap((v) => [v.x, v.y, v.z]));
    const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, new Uint32Array(mesh.indices)), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    // Which colliders are a hazard (ADR 0061: spikes knock down at a touch), for the caller that asks (M17 ticket 06b).
    if (mesh.hazard !== undefined) hazards?.add(collider.handle);
  }
  // Colliders join the query structures on a step; a zero-length one moves nothing.
  world.timestep = 0;
  world.step();
  return world;
};

class Clearance {
  private readonly world: RAPIER.World;
  private readonly shape = new RAPIER.Capsule(CAPSULE_HALF_HEIGHT * CLEARANCE_SHRINK, CAPSULE_RADIUS * CLEARANCE_SHRINK);

  constructor(resolved: BotStillWorld) {
    this.world = stillQueryWorld(resolved);
  }

  /**
   * Whether a jump off `start` (a floor point) along `direction` meets
   * nothing on its way down to `rise` above where it left: the envelope's own
   * path, the whole flight, since that is what the capsule will fly. Its end
   * is the Tick before its feet are back at the far floor's height.
   */
  clear(start: Vec3, direction: Vec3, envelope: JumpEnvelope, rise: number): boolean {
    const base = start.y + CAPSULE_BOTTOM_OFFSET + CLEARANCE_LIFT;
    const at = (sample: JumpSample): Vec3 =>
      vec3(start.x + direction.x * sample.distance, base + sample.height, start.z + direction.z * sample.distance);
    let apex = false;
    for (let i = 1; i < envelope.samples.length; i += 1) {
      const a = envelope.samples[i - 1]!;
      const b = envelope.samples[i]!;
      apex ||= b.height < a.height;
      if (apex && b.height <= rise) break;
      const from = at(a);
      const to = at(b);
      const hit = this.world.castShape(from, IDENTITY_QUAT, vec3(to.x - from.x, to.y - from.y, to.z - from.z), this.shape, 0, 1, false);
      if (hit !== null) return false;
    }
    return true;
  }

  dispose(): void {
    this.world.free();
  }
}

/** How much smaller than a Character's the capsule swept by {@link Clearance} is: it lets a candidate go only when it plainly cannot pass. */
const CLEARANCE_SHRINK = 0.8;

/** How far above its floor the swept capsule starts, so it does not start touching the deck it leaves. */
const CLEARANCE_LIFT = 0.1;

// --- Candidates -------------------------------------------------------------

/** A link worth playing: its recipe, which pair of places it is between (for spacing), and the kind it would be. */
interface Candidate {
  /** The recipes to try, in turn: built only when the candidate is played, since most never are. */
  recipes: () => LinkRecipe[];
  kind: NavLinkKind;
  key: string;
  /** Where along the border it starts, for spacing. */
  at: Vec3;
  /** Shortest first: the order candidates are played in. */
  order: number;
  /** A jump's two border points when both are on one place: played only if walking round is much longer. */
  within?: readonly [Vec3, Vec3];
  /** A jump's flight, for {@link Clearance}: played only if the air along it is clear. */
  flight?: { start: Vec3; direction: Vec3; envelope: JumpEnvelope; rise: number };
}

const FACING_COS = Math.cos((BOT_LINK_FACING_MAX_DEG * Math.PI) / 180);

/** How far a floor point is looked for on the navmesh. */
const ON_MESH = { x: 0.1, y: 0.5, z: 0.1 };

/** `point` on the navmesh (the floor under it), or `null` when the navmesh is not right there. */
const onMesh = (nav: TrackNav, point: Vec3): Vec3 | null => {
  const found = nav.query.findNearestPoly(point, { halfExtents: ON_MESH });
  if (!found.success || found.nearestRef === 0) return null;
  return groundDistance(found.nearestPoint, point) < 0.05 ? found.nearestPoint : null;
};

/**
 * The recipes for a take-off at `edge` (a border point) along `direction`:
 * the run-up starts {@link BOT_LINK_RUNUP_M} back, or less where the navmesh
 * does not go back that far, and jump is pressed at each of {@link TAKE_OFFS}
 * in turn. Without a jump (a Spring, a slide) there is one recipe.
 */
const runUps = (nav: TrackNav, edge: Vec3, direction: Vec3, jump: boolean, steerInAir: boolean): LinkRecipe[] => {
  for (const back of [BOT_LINK_RUNUP_M, BOT_LINK_RUNUP_M * 0.66, BOT_LINK_RUNUP_M * 0.4]) {
    const from = onMesh(nav, vec3(edge.x - direction.x * back, edge.y, edge.z - direction.z * back));
    if (from === null) continue;
    if (!jump) return [{ from, direction, jumpAt: null, steerInAir, dash: false }];
    return TAKE_OFFS.map((offset) => ({ from, direction, jumpAt: back + offset, steerInAir, dash: false }));
  }
  return [];
};

/**
 * Take-offs from a bounce deck (M17 ticket 05). A capsule on one hops without
 * end, so a jump can only be pressed on a Tick it lands, and where along the
 * run that is depends on when it last landed. A Bot starts a link only on a
 * Tick its capsule is on the ground (`PathFollower`), as the proof does, so
 * the recipe presses jump at once, on that Tick, and the distance back from
 * the edge is what is tried in turn.
 */
const bounceRecipes = (nav: TrackNav, edge: Vec3, direction: Vec3): LinkRecipe[] => {
  const recipes: LinkRecipe[] = [];
  for (const back of BOUNCE_TAKE_OFFS) {
    const from = onMesh(nav, vec3(edge.x - direction.x * back, edge.y, edge.z - direction.z * back));
    if (from !== null) recipes.push({ from, direction, jumpAt: -BOT_CORNER_REACHED_M, steerInAir: true, dash: false });
  }
  return recipes;
};

/** How far back from a bounce deck's edge its take-offs are tried, in metres: a bounce jump carries several. */
const BOUNCE_TAKE_OFFS = [0.5, 1.5, 2.5, 3.5];

/** Where jump is pressed against the border sample, in metres along the run: on it first, then short of it, then past it (the capsule is still on the floor there, the border being a radius in from the edge). */
const TAKE_OFFS = [0, -NAV_AGENT_RADIUS, NAV_AGENT_RADIUS * 0.7];

/** A spatial hash of border samples on the ground, for the pairs within a jump of each other. */
const bucketed = (samples: readonly BorderSample[], cell: number): Map<string, BorderSample[]> => {
  const grid = new Map<string, BorderSample[]>();
  for (const sample of samples) {
    const key = `${Math.floor(sample.point.x / cell)},${Math.floor(sample.point.z / cell)}`;
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [sample]);
    else list.push(sample);
  }
  return grid;
};

/** Whether walking from `a` to `b` is already about as good as a link between them. */
const walkable = (nav: TrackNav, a: Vec3, b: Vec3): boolean => {
  const path = navPath(nav, a, b);
  const last = path?.at(-1);
  if (path === null || last === undefined || groundDistance(last, b) > 1) return false;
  let length = 0;
  for (let i = 1; i < path.length; i += 1) length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y, path[i]!.z - path[i - 1]!.z);
  return length <= Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) + BOT_LINK_MIN_SAVING_M;
};

/**
 * Jumps: two borders facing each other within a jump's reach, one a little
 * higher or lower than the other: across a gap, up a tier or down one. The
 * reach is the take-off Surface's measured jump ({@link jumpEnvelope}), plus
 * the capsule's radius at each end, since a border is that far in from its
 * floor's edge.
 */
const jumpCandidates = (nav: TrackNav, samples: readonly BorderSample[]): Candidate[] => {
  const surfaces = [...new Set(samples.map((sample) => sample.surface))];
  const reachMax = Math.max(...surfaces.map((surface) => reachAt(jumpEnvelope(surface), -BOT_LINK_MAX_DROP_M))) + 2 * NAV_AGENT_RADIUS;
  const grid = bucketed(samples, reachMax);
  const out: Candidate[] = [];
  for (const s of samples) {
    const envelope = jumpEnvelope(s.surface);
    const cx = Math.floor(s.point.x / reachMax);
    const cz = Math.floor(s.point.z / reachMax);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const t of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (t === s) continue;
          const rise = t.point.y - s.point.y;
          if (rise > envelope.rise || rise < -BOT_LINK_MAX_DROP_M) continue;
          const gap = groundDistance(s.point, t.point);
          if (gap < NAV_AGENT_RADIUS || gap > reachAt(envelope, rise) + 2 * NAV_AGENT_RADIUS) continue;
          const ux = (t.point.x - s.point.x) / gap;
          const uz = (t.point.z - s.point.z) / gap;
          if (s.normal.x * ux + s.normal.z * uz < FACING_COS) continue;
          if (-(t.normal.x * ux + t.normal.z * uz) < FACING_COS) continue;
          out.push({
            recipes: () =>
              s.surface === BOUNCE_SURFACE_ID ? bounceRecipes(nav, s.point, vec3(ux, 0, uz)) : runUps(nav, s.point, vec3(ux, 0, uz), true, true),
            kind: s.surface === BOUNCE_SURFACE_ID ? "bounce" : "jump",
            key: `jump ${s.place} ${t.place}`,
            at: s.point,
            order: gap + Math.abs(rise),
            ...(s.place === t.place ? { within: [s.point, t.point] as const } : {}),
            flight: { start: s.point, direction: vec3(ux, 0, uz), envelope, rise },
          });
        }
      }
    }
  }
  return out;
};

/**
 * Updrafts: a border facing an upward Volume within a jump's reach of it,
 * low enough to jump into it. Where it carries the capsule is found by
 * playing it.
 */
const updraftCandidates = (nav: TrackNav, samples: readonly BorderSample[], resolved: BotStillWorld): Candidate[] => {
  const out: Candidate[] = [];
  resolved.volumes.forEach((volume, v) => {
    if (volume.force.y <= 0) return;
    const { center, halfExtents, rotation } = volume.bounds;
    const q = rotation ?? IDENTITY_QUAT;
    // The Volume's footprint as a circle round its middle, and its height span.
    const radius = Math.hypot(halfExtents.x, halfExtents.z);
    const height = Math.abs(rotateVec3ByQuat(vec3(0, halfExtents.y, 0), q).y) + Math.abs(rotateVec3ByQuat(vec3(halfExtents.x, 0, halfExtents.z), q).y);
    for (const s of samples) {
      const envelope = jumpEnvelope(s.surface);
      const distance = groundDistance(s.point, center);
      if (distance - radius > reachAt(envelope, 0) + NAV_AGENT_RADIUS || distance < 1e-6) continue;
      if (s.point.y + envelope.rise < center.y - height || s.point.y > center.y + height) continue;
      const ux = (center.x - s.point.x) / distance;
      const uz = (center.z - s.point.z) / distance;
      if (s.normal.x * ux + s.normal.z * uz < FACING_COS) continue;
      out.push({
        recipes: () => runUps(nav, s.point, vec3(ux, 0, uz), true, true),
        kind: "updraft",
        key: `updraft ${v} ${s.place}`,
        at: s.point,
        order: distance,
      });
    }
  });
  return out;
};

/**
 * Springs and launch pads: walked onto from each side of the pad, with the
 * direction pushed through the throw or let go. Where each lands is played,
 * never worked out from the pad's velocity.
 */
const launchCandidates = (nav: TrackNav, resolved: BotStillWorld): Candidate[] => {
  const out: Candidate[] = [];
  resolved.launchPads.forEach((pad, p) => {
    const { center, halfExtents, rotation } = pad.trigger;
    const q = rotation ?? IDENTITY_QUAT;
    const floor = nav.query.findNearestPoly(center, { halfExtents: { x: 1, y: 3, z: 1 } });
    const y = floor.success && floor.nearestRef !== 0 ? floor.nearestPoint.y : center.y;
    // Each side is its own link: where a Spring's throw lands depends on which way the capsule came on.
    for (const [side, axis] of [vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1)].entries()) {
      const world = rotateVec3ByQuat(axis, q);
      const length = Math.hypot(world.x, world.z);
      if (length < 1e-6) continue;
      const into = vec3(-world.x / length, 0, -world.z / length);
      const reachOut = Math.abs(axis.x) * halfExtents.x + Math.abs(axis.z) * halfExtents.z;
      const edge = vec3(center.x - into.x * reachOut, y, center.z - into.z * reachOut);
      for (const steerInAir of [true, false]) {
        out.push({ recipes: () => runUps(nav, edge, into, false, steerInAir), kind: "launch", key: `launch ${p} ${side}`, at: edge, order: 0 });
      }
    }
  });
  return out;
};

/**
 * Sliding ramps: a border with a Sliding slope just beyond it, falling away
 * from it (ADR 0037). Walked off, pushed on down the ramp, and kept where the
 * slide ends on the navmesh. The slopes are read off the navmesh's own input
 * triangles, by the same two thresholds the simulation uses.
 */
const slideCandidates = (nav: TrackNav, samples: readonly BorderSample[], input: NavInput): Candidate[] => {
  const { positions, indices } = input;
  const corner = (t: number, k: number): Vec3 => {
    const i = indices[t * 3 + k]!;
    return vec3(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
  };
  const walkableY = Math.cos(WALKABLE_SLOPE_MAX_ANGLE);
  // Every Sliding triangle, by the 2 m cells its footprint's bounds cover.
  const cells = new Map<string, number[]>();
  const normals = new Map<number, Vec3>();
  for (let t = 0; t < indices.length / 3; t += 1) {
    const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const n = cross(subVec3(b, a), subVec3(c, a));
    const length = Math.hypot(n.x, n.y, n.z);
    if (length === 0 || n.y / length >= walkableY || n.y / length < WALL_NORMAL_MAX_Y) continue;
    normals.set(t, vec3(n.x / length, n.y / length, n.z / length));
    for (let x = cellOf(Math.min(a.x, b.x, c.x)); x <= cellOf(Math.max(a.x, b.x, c.x)); x += 1) {
      for (let z = cellOf(Math.min(a.z, b.z, c.z)); z <= cellOf(Math.max(a.z, b.z, c.z)); z += 1) {
        const list = cells.get(`${x},${z}`);
        if (list === undefined) cells.set(`${x},${z}`, [t]);
        else list.push(t);
      }
    }
  }
  /** The Sliding triangle under `point` on the ground, and its height there. */
  const slopeUnder = (point: Vec3): { triangle: number; y: number } | null => {
    for (const t of cells.get(`${cellOf(point.x)},${cellOf(point.z)}`) ?? []) {
      const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (d === 0) continue;
      const l1 = ((b.z - c.z) * (point.x - c.x) + (c.x - b.x) * (point.z - c.z)) / d;
      const l2 = ((c.z - a.z) * (point.x - c.x) + (a.x - c.x) * (point.z - c.z)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      return { triangle: t, y: l1 * a.y + l2 * b.y + l3 * c.y };
    }
    return null;
  };
  const out: Candidate[] = [];
  for (const s of samples) {
    // Just past the edge the border is a radius in from.
    const beyond = NAV_AGENT_RADIUS + 0.4;
    const probe = vec3(s.point.x + s.normal.x * beyond, 0, s.point.z + s.normal.z * beyond);
    const slope = slopeUnder(probe);
    if (slope === null || slope.y > s.point.y + 0.2 || slope.y < s.point.y - 1) continue;
    // Downhill is where the slope's normal leans; it must lean away from the border.
    const normal = normals.get(slope.triangle)!;
    const length = Math.hypot(normal.x, normal.z);
    const down = vec3(normal.x / length, 0, normal.z / length);
    if (down.x * s.normal.x + down.z * s.normal.z < FACING_COS) continue;
    out.push({
      recipes: () => runUps(nav, s.point, down, false, true),
      kind: "slide",
      // One slide per place per 8 m of ramp.
      key: `slide ${s.place} ${Math.floor(probe.x / 8)},${Math.floor(probe.z / 8)}`,
      at: s.point,
      order: 0,
    });
  }
  return out;
};

/** The 2 m cell a coordinate falls in, for {@link slideCandidates}' index of Sliding triangles. */
const cellOf = (coordinate: number): number => Math.floor(coordinate / 2);
const cross = (a: Vec3, b: Vec3): Vec3 => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

// --- Playing them -----------------------------------------------------------

const PROVE_ID = "link";

/** How many Ticks a capsule put down for a proof is given to find its floor before the link starts. */
const SETTLE_TICKS = 10;

/**
 * The scratch world links are played in, with its one capsule. The capsule is
 * added once and put back at each start by a reconcile, the way a client's
 * prediction resets its own Character: adding a Character seats it with a
 * query over the whole world (`clearSeat`), which on an authored Race cost
 * more than the play itself (measured, M17 ticket 05).
 */
class ProofWorld {
  readonly sim: RapierSimulation;
  private readonly fresh: CharacterSnapshot;

  constructor(
    resolved: BotStillWorld,
    private readonly nav: TrackNav,
    first: Vec3,
  ) {
    this.sim = new RapierSimulation({
      statics: resolved.statics,
      staticSurfaces: resolved.staticSurfaces,
      staticConveyors: resolved.staticConveyors,
      staticTrimeshes: resolved.staticTrimeshes,
      launchPads: resolved.launchPads,
      volumes: resolved.volumes,
      withDefaultCharacter: false,
      authoritative: false,
    });
    this.sim.addCharacter(PROVE_ID, standingOn(first));
    this.fresh = this.self();
  }

  self(): CharacterSnapshot {
    return this.sim.snapshot().characters[PROVE_ID]!;
  }

  /**
   * Puts the capsule down standing on `start` (a floor point) and lets it
   * find its floor; the Falls it had before, or `null` when it cannot be put
   * at `phase`. On a bounce deck (M17 ticket 06b) `phase` is where in the
   * deck's settled hop (as {@link hop} measures it) its latest Snapshot is when the
   * link begins: it is left to hop until its feet come down after a rebound,
   * and then `phase` Ticks more.
   */
  private standOn(start: Vec3, phase?: number): number | null {
    const { sim } = this;
    sim.reconcileCharacter(PROVE_ID, { ...this.fresh, position: standingOn(start), velocity: vec3() });
    const falls = this.self().fallCount;
    for (let tick = 0; tick < SETTLE_TICKS && !this.self().grounded; tick += 1) sim.tick({ [PROVE_ID]: IDLE_INPUTS });
    if (phase === undefined) {
      // Standing is feet down two Ticks running and not rising (M17 ticket 06b): a reconcile
      // leaves the Surface the capsule last stood on in its controller for its
      // first landing, so after a play that ended on a bounce deck the first
      // landing on plain floor rebounded, and a jump pressed then was pressed
      // in the air. Every link onto a bounce deck failed its replay so.
      let before = this.self();
      for (let tick = 0; tick < HOP_FIND_TICKS; tick += 1) {
        sim.tick({ [PROVE_ID]: IDLE_INPUTS });
        const self = this.self();
        if (self.grounded && before.grounded && self.velocity.y <= 0) break;
        before = self;
      }
      return falls;
    }
    // The first Tick down is the capsule put down, not a hop: wait for the next landing.
    let before = this.self();
    let landings = before.grounded ? 1 : 0;
    for (let tick = 0; landings < 2; tick += 1) {
      if (tick > HOP_FIND_TICKS) return null;
      sim.tick({ [PROVE_ID]: IDLE_INPUTS });
      const self = this.self();
      if (self.grounded && !before.grounded) landings += 1;
      before = self;
    }
    for (let tick = 0; tick < phase; tick += 1) sim.tick({ [PROVE_ID]: IDLE_INPUTS });
    return falls;
  }

  /** Whether the capsule is lost: Fallen, down, or further below `start` than any jump lands (it would fall for seconds to the kill plane). */
  private lost(self: CharacterSnapshot, falls: number, start: Vec3, deep: boolean): boolean {
    if (self.fallCount > falls || isDownMotionState(self.motionState)) return true;
    return deep && self.position.y - CAPSULE_BOTTOM_OFFSET < start.y - BOT_LINK_MAX_DROP_M - 0.5;
  }

  /**
   * The hop a capsule standing on `start` settles into, where `start` is on a
   * bounce deck (M17 ticket 06b): one whole hop, a Tick an entry, from the
   * first Tick its feet come down after a rebound (phase 0, as
   * {@link standOn} counts phases). Measured where the link starts, so a Bot
   * reads its own hop there against exactly what it will see. `null` when
   * the capsule does not come down again.
   */
  hop(start: Vec3): HopState[] | null {
    const { sim } = this;
    if (this.standOn(start, 0) === null) return null;
    let self = this.self();
    const floorY = self.position.y;
    const cycle: HopState[] = [];
    for (let tick = 0; tick < HOP_FIND_TICKS; tick += 1) {
      cycle.push({ grounded: self.grounded, vy: self.velocity.y, dy: self.position.y - floorY });
      sim.tick({ [PROVE_ID]: IDLE_INPUTS });
      const next = this.self();
      if (next.grounded && !self.grounded) return cycle;
      self = next;
    }
    return null;
  }

  /**
   * Plays `recipe` from `start` (a floor point) and returns where it landed
   * and stood, on the floor, with every input it sent (the link's script,
   * M17 ticket 06), or `null`: a Fall, a knockdown, or never standing again
   * within the link's time.
   */
  play(recipe: LinkRecipe, start: Vec3, phase?: number): { landed: Vec3; script: LinkScriptStep[] } | null {
    const { sim } = this;
    const falls = this.standOn(start, phase);
    if (falls === null) return null;
    const run = new LinkRun(recipe);
    const script: LinkScriptStep[] = [];
    for (let tick = 0; tick < BOT_LINK_MAX_TICKS + 2; tick += 1) {
      const self = this.self();
      // A slide or a Spring may go further down than a jump lands; there are few.
      if (this.lost(self, falls, start, recipe.jumpAt !== null)) return null;
      const step = run.step(self, navStandsOn(this.nav, self.position));
      if (step.failed) return null;
      if (step.done) return { landed: vec3(self.position.x, self.position.y - CAPSULE_BOTTOM_OFFSET, self.position.z), script };
      script.push({ x: step.moveDirection.x, z: step.moveDirection.z, jump: step.jump });
      sim.tick({ [PROVE_ID]: { ...IDLE_INPUTS, moveDirection: step.moveDirection, jumpHeld: step.jump } });
    }
    return null;
  }

  /**
   * Plays a link's `script` from `start` exactly as a Bot does (M17 ticket
   * 06, `LinkReplay`): every step as recorded, nothing read back, and then
   * stands for as long as the slowest Bot's view takes to catch up
   * ({@link BOT_STALE_TICKS_MAX}). Where it stood, on the floor, or `null`:
   * a Fall, a knockdown, or not standing at the end.
   */
  replay(script: readonly LinkScriptStep[], start: Vec3, deep: boolean, phase?: number): Vec3 | null {
    const { sim } = this;
    const falls = this.standOn(start, phase);
    if (falls === null) return null;
    for (const step of script) {
      if (this.lost(this.self(), falls, start, deep)) return null;
      sim.tick({ [PROVE_ID]: { ...IDLE_INPUTS, moveDirection: vec3(step.x, 0, step.z), jumpHeld: step.jump } });
    }
    // Standing: on a bounce deck a capsule that arrived off a jump never stops
    // hopping (the deck gives back at least its `minSpeed`), so standing is
    // having its feet down on some Tick of the wait, and where it last had them
    // down is where it stands. Where that is, is the caller's to judge against
    // the navmesh (`landing`): a slide's foot can leave a capsule standing on
    // the slope's last metre.
    //
    // M17 ticket 06b: a jump landing on a bounce deck rebounds higher than
    // that wait is long, so it goes on until the feet have been down once:
    // the Bot, standing meanwhile, waits the same (`PathFollower`'s landing).
    let stood: Vec3 | null = null;
    for (let tick = 0; tick <= BOT_STALE_TICKS_MAX + 1 || (stood === null && tick <= HOP_FIND_TICKS); tick += 1) {
      const self = this.self();
      if (this.lost(self, falls, start, deep)) return null;
      if (self.grounded) stood = vec3(self.position.x, self.position.y - CAPSULE_BOTTOM_OFFSET, self.position.z);
      if (tick <= BOT_STALE_TICKS_MAX || stood === null) sim.tick({ [PROVE_ID]: IDLE_INPUTS });
    }
    return stood;
  }

  dispose(): void {
    this.sim.dispose();
  }
}

/** How long a capsule on a bounce deck is given to come down from a hop: longer than any hop a deck gives back. */
const HOP_FIND_TICKS = 3 * TICK_RATE_HZ;

/** How far above a floor point a capsule is put down: its centre, and a hair over so it settles rather than starting inside. */
const standingOn = (floor: Vec3): Vec3 => vec3(floor.x, floor.y + CAPSULE_BOTTOM_OFFSET + 0.05, floor.z);

/** What proving a Track's links cost and found (M17 ticket 05), for the suites and the ticket's measurements. */
export interface LinkProofReport {
  candidates: number;
  /** How many were played at all (the rest were spaced out, or past their pair's cap). */
  attempts: number;
  /** Every `play`, the lateral trials included. */
  plays: number;
  links: number;
  ms: number;
  /** Candidates, attempts and links, by kind. */
  byKind: Partial<Record<NavLinkKind, { candidates: number; attempts: number; links: number }>>;
  /** Each link from a bounce deck (M17 ticket 06b): how many of its hop's phases are safe, and the most in a row. */
  hops: { safe: number; run: number; of: number }[];
}

let lastReport: LinkProofReport | null = null;

/** The last {@link proveNavLinks} call's report. */
export const lastLinkProofReport = (): LinkProofReport | null => lastReport;

/**
 * Every link on a Track that playing proves (M17 ticket 05): the candidates
 * above, shortest first, each played from its run-up, and its script then
 * replayed from there and from around it (`besideToo`: where a Bot may be
 * standing when it starts the link, M17 ticket 06), and kept only if all of
 * them land and stand, on the navmesh, somewhere a walk from the start does
 * not already reach about as well. The link ends where the proof from the
 * run-up itself landed.
 *
 * Needs `initPhysics()` to have been awaited.
 */
export const proveNavLinks = (resolved: BotStillWorld, nav: TrackNav, input: NavInput): NavLink[] => {
  const started = performance.now();
  const samples = borderSamples(nav);
  const candidates = [
    ...launchCandidates(nav, resolved),
    ...slideCandidates(nav, samples, input),
    ...updraftCandidates(nav, samples, resolved),
    ...jumpCandidates(nav, samples),
  ];
  candidates.sort((a, b) => a.order - b.order);
  let world: ProofWorld | null = null;
  let clearance: Clearance | null = null;
  const links: NavLink[] = [];
  const starts = new Map<string, Vec3[]>();
  const attempts = new Map<string, number>();
  let attempted = 0;
  let plays = 0;
  const byKind: LinkProofReport["byKind"] = {};
  const tally = (kind: NavLinkKind) => (byKind[kind] ??= { candidates: 0, attempts: 0, links: 0 });
  for (const candidate of candidates) tally(candidate.kind).candidates += 1;
  try {
    for (const candidate of candidates) {
      const kept = starts.get(candidate.key) ?? [];
      if (kept.some((at) => groundDistance(at, candidate.at) < BOT_LINK_SPACING_M)) continue;
      const tried = attempts.get(candidate.key) ?? 0;
      if (tried >= BOT_LINK_ATTEMPTS_PER_PAIR) continue;
      if (candidate.within !== undefined && walkable(nav, ...candidate.within)) continue;
      if (candidate.flight !== undefined) {
        clearance ??= new Clearance(resolved);
        const { start, direction, envelope, rise } = candidate.flight;
        if (!clearance.clear(start, direction, envelope, rise)) continue;
      }
      const recipes = candidate.recipes();
      if (recipes.length === 0) continue;
      attempts.set(candidate.key, tried + 1);
      attempted += 1;
      tally(candidate.kind).attempts += 1;
      let best: NavLink | null = null;
      for (const recipe of recipes) {
        plays += 1;
        world ??= new ProofWorld(resolved, nav, recipe.from);
        // M17 ticket 06b: a start on a bounce deck is somewhere in its hop, and is played from each phase of it.
        const hops = surfaceConfig(navSurfaceAt(nav, recipe.from) ?? undefined).bounce !== undefined;
        const played = world.play(recipe, recipe.from, hops ? 0 : undefined);
        if (played === null) continue;
        const to = landing(nav, played.landed);
        if (to === null || walkable(nav, recipe.from, to)) continue;
        const counted = () => (plays += 1);
        if (!hops) {
          if (!besideToo(world, nav, recipe, played.script, counted)) continue;
          best = { ...recipe, kind: candidate.kind, to, script: played.script };
          break;
        }
        const hop = hopPhases(world, nav, recipe, played.script, counted);
        if (hop === null) continue;
        best = { ...recipe, kind: candidate.kind, to, script: played.script, hop };
        break;
      }
      if (best === null) continue;
      links.push(best);
      tally(candidate.kind).links += 1;
      starts.set(candidate.key, [...kept, candidate.at]);
    }
  } finally {
    world?.dispose();
    clearance?.dispose();
  }
  const hops = links.flatMap(({ hop }) => (hop === undefined ? [] : [{ safe: hop.safe.filter(Boolean).length, run: hopSafeRun(hop.safe), of: hop.safe.length }]));
  lastReport = { candidates: candidates.length, attempts: attempted, plays, links: links.length, ms: performance.now() - started, byKind, hops };
  return links;
};

/** The navmesh right under where a proof stood, or `null` if it stood somewhere the navmesh is not (a post top, a railing). */
const landing = (nav: TrackNav, feet: Vec3): Vec3 | null => {
  const found = nav.query.findNearestPoly(feet, { halfExtents: { x: 0.5, y: 0.6, z: 0.5 } });
  if (!found.success || found.nearestRef === 0) return null;
  return found.nearestPoint;
};

/**
 * The link's script played as a Bot plays it (M17 ticket 06): from its own
 * start, then from {@link BOT_LINK_START_SIDE_M} to either side and
 * {@link BOT_LINK_START_ALONG_M} either way along its run-up, the box a Bot
 * stands in when it begins (`PathFollower`), with nothing read back. Every
 * one must land and stand usefully. A start that is off the navmesh is not
 * asked, since no Bot stands there.
 */
const besideToo = (
  world: ProofWorld,
  nav: TrackNav,
  recipe: LinkRecipe,
  script: readonly LinkScriptStep[],
  counted: () => void,
  phase?: number,
): boolean => {
  const { direction, from } = recipe;
  const side = vec3(-direction.z, 0, direction.x);
  const offsets: [Vec3, number][] = [
    [vec3(), 0],
    [side, -BOT_LINK_START_SIDE_M],
    [side, BOT_LINK_START_SIDE_M],
    [direction, -BOT_LINK_START_ALONG_M],
    [direction, BOT_LINK_START_ALONG_M],
  ];
  for (const [axis, by] of offsets) {
    const start = by === 0 ? from : onMesh(nav, vec3(from.x + axis.x * by, from.y, from.z + axis.z * by));
    if (start === null) continue;
    counted();
    const landed = world.replay(script, start, recipe.jumpAt !== null, phase);
    if (landed === null) return false;
    const to = landing(nav, landed);
    if (to === null || walkable(nav, start, to)) return false;
  }
  return true;
};

/**
 * A link that starts on a bounce deck, played from every phase of the hop a
 * capsule settles into there (M17 ticket 06b): the capsule is always
 * somewhere in its hop, and jump only counts pressed within a few Ticks of a
 * landing, so a script proven from one phase ({@link ProofWorld.play}'s
 * phase 0) is no proof from another. Each phase is played from the start and
 * from beside it ({@link besideToo}); the phases that all land are the
 * link's safe ones. Kept only when enough of them in a row are safe for the
 * latest-seeing Bot to time ({@link BOT_HOP_SAFE_RUN_MIN}), so every Bot can
 * take every link it is given; `null` otherwise.
 *
 * Only the run of safe phases round phase 0 is found: the phases are played
 * outward from 0, each way until the first that fails, and the rest are
 * left unsafe unplayed. The script was recorded at phase 0, so a link's safe
 * run holds phase 0 whenever it holds anything (every bounce link on the
 * authored Tracks does), and a second run further round the hop would only
 * be more phases to start from. Proving costs the Round's LOADING (ADR
 * 0129), and this is what the phases add: the settled hop plus the run and
 * two failures, rather than every phase.
 */
const hopPhases = (
  world: ProofWorld,
  nav: TrackNav,
  recipe: LinkRecipe,
  script: readonly LinkScriptStep[],
  counted: () => void,
): LinkHop | null => {
  const cycle = world.hop(recipe.from);
  if (cycle === null) return null;
  const safe = cycle.map(() => false);
  const proves = (phase: number): boolean => (safe[phase] = besideToo(world, nav, recipe, script, counted, phase));
  if (!proves(0)) return null;
  let run = 1;
  for (let phase = 1; run < cycle.length && proves(phase); phase += 1) run += 1;
  for (let phase = cycle.length - 1; run < cycle.length && proves(phase); phase -= 1) run += 1;
  return run >= BOT_HOP_SAFE_RUN_MIN ? { cycle, safe } : null;
};

// --- Kept per Track ----------------------------------------------------------

/**
 * Proven links, by the still geometry they were proven on (M17 ticket 05).
 * Proving is the whole cost of a Track's links (measured on Apple M4: 1.0 s
 * on the base race, 1.9 s on Spin Cycle and Slip Stream at rest), and on the
 * Match server it runs on the one loop every Lobby Ticks on, so it runs once
 * per Track Revision a process sees rather than once per Round. A Revision
 * never changes (ADR 0032), so its geometry is its key; keying by the
 * geometry rather than the Revision's id keeps a builder draft, which has no
 * Revision, under the same rule. Nothing is kept across processes: links
 * follow the tuning, which is only fixed for a process's life.
 */
const proven = new Map<string, readonly NavLink[]>();

/** How many Tracks' links a process keeps: a Lobby cycles through a handful. */
const PROVEN_TRACKS_KEPT = 16;

/**
 * {@link proveNavLinks}, once per still geometry: a Track proven before in
 * this process gets the same links back without playing anything.
 */
export const provenNavLinks = (resolved: BotStillWorld, nav: TrackNav, input: NavInput): readonly NavLink[] => {
  const key = stillGeometryKey(resolved);
  const known = proven.get(key);
  if (known !== undefined) {
    // Most recently used last, so the oldest is the one let go.
    proven.delete(key);
    proven.set(key, known);
    return known;
  }
  const links = proveNavLinks(resolved, nav, input);
  proven.set(key, links);
  if (proven.size > PROVEN_TRACKS_KEPT) proven.delete(proven.keys().next().value!);
  return links;
};

/**
 * A key for everything {@link proveNavLinks} reads of a resolved Track: two
 * independent 32-bit hashes over its still geometry, Surfaces, belts, pads
 * and Volumes, rounded to a tenth of a millimetre, and their counts.
 */
const stillGeometryKey = (resolved: BotStillWorld): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  let count = 0;
  const mix = (value: number): void => {
    const n = Math.round(value * 1e4) | 0;
    a = Math.imul(a ^ n, 0x01000193);
    b = Math.imul(b ^ n, 0x5bd1e995) ^ (b >>> 13);
    count += 1;
  };
  const text = (value: string): void => {
    for (let i = 0; i < value.length; i += 1) mix(value.charCodeAt(i));
  };
  const point = (v: Vec3 | undefined): void => {
    if (v === undefined) return mix(Number.NaN);
    mix(v.x);
    mix(v.y);
    mix(v.z);
  };
  const box = ({ center, halfExtents, rotation }: { center: Vec3; halfExtents: Vec3; rotation?: { x: number; y: number; z: number; w: number } }): void => {
    point(center);
    point(halfExtents);
    const q = rotation ?? IDENTITY_QUAT;
    mix(q.x);
    mix(q.y);
    mix(q.z);
    mix(q.w);
  };
  resolved.statics.forEach((still, i) => {
    box(still);
    text(resolved.staticSurfaces[i] ?? DEFAULT_SURFACE);
    point(resolved.staticConveyors[i]);
  });
  for (const mesh of resolved.staticTrimeshes) {
    mix(mesh.vertices.length);
    for (const v of mesh.vertices) point(v);
    for (const i of mesh.indices) mix(i);
    text(mesh.surface);
    text(mesh.hazard ?? "");
    point(mesh.conveyor);
  }
  for (const pad of resolved.launchPads) {
    box(pad.trigger);
    point(pad.velocity);
  }
  for (const volume of resolved.volumes) {
    box(volume.bounds);
    point(volume.force);
    mix(volume.maxInducedSpeed);
    mix(volume.priority);
  }
  return `${count}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
};
