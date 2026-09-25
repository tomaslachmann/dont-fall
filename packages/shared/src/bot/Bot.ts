import { raceTargets, type RaceTargets } from "../match/LiveRace.js";
import type { OrientedBox } from "../math/box.js";
import { mulQuat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, type Vec3 } from "../math/vec3.js";
import type { FragileState } from "../track/Fragile.js";
import type { MotionClock } from "../track/Motion.js";
import type { RoundRules } from "../match/RoundRules.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot, PropSnapshot } from "../state/SimState.js";
import type { BombState } from "../track/Bomb.js";
import type { ResolvedTrack } from "../track/resolveTrack.js";
import { markVoidEdges } from "./edgeGuard.js";
import { provenNavLinks } from "./linkProof.js";
import { movingWorldOf, type MovingWorld } from "./movingWorld.js";
import { trackNavInput, type BotStillWorld, type GatedFloor } from "./navInput.js";
import type { StaticTrimesh } from "../track/resolveTrack.js";
import { buildTrackNav, disposeTrackNav, markGatedPolys, trackNavData, trackNavFromData, type TrackNav, type TrackNavData } from "./navMesh.js";

/**
 * A Round's Track as every Bot in it reads it (ADR 0129): the resolved Track
 * the simulation was built from, its navmesh, and where a runner heads. Built
 * once when the Round's Track loads and shared by every Bot on it. The
 * navmesh is built every time (42–96 ms on the authored Races, M17 ticket 01);
 * the links in it are proven once per Track a process sees (ticket 05,
 * `provenNavLinks`), since proving costs seconds.
 */
export interface BotTrack {
  readonly resolved: ResolvedTrack;
  readonly nav: TrackNav;
  /** Each Checkpoint's centre, then the Finish Zones: what live Race placement measures against too (ADR 0088). */
  readonly targets: RaceTargets;
  /**
   * Each Race leg's fork arms (`forkArms`), by the index of the Checkpoint
   * the leg runs to (the Checkpoint count for the finish), found the first
   * time a Bot runs the leg and kept for every Bot after it (M17 ticket 04).
   */
  readonly forks: Map<number, readonly Vec3[]>;
  /** Every body that moves, switches off or breaks, and where each is at any Tick (M17 ticket 07). */
  readonly moving: MovingWorld;
}

/**
 * Builds a {@link BotTrack}, with the links its navmesh cannot see proven
 * and built in (M17 ticket 05, `proveNavLinks`). Needs `initNavigation()` and
 * `initPhysics()` to have been awaited: links are proven in the real
 * simulation.
 */
export const buildBotTrack = (resolved: ResolvedTrack): BotTrack => botTrackOf(resolved, buildBotNav(botStillWorldOf(resolved)));

/**
 * What of `resolved` a Bot's navmesh is built from (M17 ticket 05), with
 * every gated floor at its rest pose (ticket 07).
 */
export const botStillWorldOf = (resolved: ResolvedTrack): BotStillWorld => ({ ...resolved, gatedFloors: gatedFloorsOf(resolved) });

/**
 * Every trap door leaf and fragile block of `resolved`, as still world-space
 * geometry at its rest pose (M17 ticket 07): what `trackNavInput` rasterises
 * walkable and `markGatedPolys` flags. A solid that is not a box is taken as
 * the box round it, which is only ever a little too generous.
 */
export const gatedFloorsOf = (resolved: ResolvedTrack): GatedFloor[] => {
  const floors: GatedFloor[] = [];
  for (const body of resolved.movingSegments) {
    if (body.trapDoor === undefined && body.fragile === undefined) continue;
    const place = (p: Vec3): Vec3 => addVec3(rotateVec3ByQuat(p, body.orientation), body.position);
    const boxes: OrientedBox[] = [];
    const surfaces = [];
    for (const { box, surface } of body.boxes) {
      boxes.push({ center: place(box.center), halfExtents: box.halfExtents, rotation: body.orientation });
      surfaces.push(surface);
    }
    for (const solid of body.solids) {
      const { shape } = solid;
      let halfExtents: Vec3;
      switch (shape.type) {
        case "box":
          halfExtents = shape.halfExtents;
          break;
        case "ball":
          halfExtents = { x: shape.radius, y: shape.radius, z: shape.radius };
          break;
        case "capsule":
          halfExtents = { x: shape.radius, y: shape.halfHeight + shape.radius, z: shape.radius };
          break;
        case "cylinder":
          halfExtents = { x: shape.radius, y: shape.halfHeight, z: shape.radius };
          break;
        case "hull": {
          const max = { x: 0, y: 0, z: 0 };
          for (const point of shape.points) {
            max.x = Math.max(max.x, Math.abs(point.x));
            max.y = Math.max(max.y, Math.abs(point.y));
            max.z = Math.max(max.z, Math.abs(point.z));
          }
          halfExtents = max;
          break;
        }
      }
      boxes.push({ center: place(solid.position), halfExtents, rotation: mulQuat(body.orientation, solid.rotation) });
      surfaces.push(solid.surface);
    }
    const trimeshes: StaticTrimesh[] = body.trimeshes.map((mesh) => ({
      vertices: mesh.vertices.map(place),
      indices: mesh.indices,
      surface: mesh.surface,
      ...(mesh.hazard === undefined ? {} : { hazard: mesh.hazard }),
    }));
    floors.push({ segmentIndex: body.segmentIndex, boxes, surfaces, trimeshes });
  }
  return floors;
};

/**
 * The costly half of {@link buildBotTrack} as plain data: the navmesh, with its
 * links proven, serialised (M17 ticket 05). The Match server runs it on a
 * worker thread and hands the result to {@link botTrackFromData}, so proving
 * links (up to a second the first time a process sees a Track) never stalls
 * the loop every Lobby Ticks on.
 */
export const buildBotTrackData = (world: BotStillWorld): TrackNavData => {
  const nav = buildBotNav(world);
  try {
    return trackNavData(nav);
  } finally {
    disposeTrackNav(nav);
  }
};

/** The cheap half: a {@link BotTrack} from {@link buildBotTrackData}'s output, on this thread. */
export const botTrackFromData = (resolved: ResolvedTrack, data: TrackNavData): BotTrack => botTrackOf(resolved, trackNavFromData(data));

const buildBotNav = (world: BotStillWorld): TrackNav => {
  const input = trackNavInput(world);
  const nav = buildTrackNav(input, (plain) => provenNavLinks(world, plain, input));
  // Which borders are drops, asked of the still geometry itself (M17 ticket 06).
  markVoidEdges(nav, world);
  // Which polygons are a gated floor's (M17 ticket 07).
  markGatedPolys(nav, world.gatedFloors ?? []);
  return nav;
};

/** A {@link StaticTrimesh} with its corners and indices as flat typed arrays, which cross a thread without being walked. */
export interface PackedTrimesh extends Omit<StaticTrimesh, "vertices" | "indices"> {
  vertices: Float64Array;
  indices: Uint32Array;
}

/** A {@link BotStillWorld} as posted to the Bot track worker. */
export interface PackedBotStillWorld extends Omit<BotStillWorld, "staticTrimeshes"> {
  staticTrimeshes: PackedTrimesh[];
}

/**
 * Packs what a Bot's navmesh is built from for the Bot track worker (M17
 * ticket 05), with the buffers to transfer rather than copy. Structured
 * cloning the trimeshes' tens of thousands of `Vec3` objects cost Spin Cycle
 * 22 ms on the Match loop; packed, it costs about 1 ms. `Float64Array`, so
 * nothing is rounded on the way.
 */
export const packBotStillWorld = (resolved: BotStillWorld): { world: PackedBotStillWorld; transfer: ArrayBuffer[] } => {
  const transfer: ArrayBuffer[] = [];
  const staticTrimeshes = resolved.staticTrimeshes.map(({ vertices, indices, ...rest }) => {
    const flat = new Float64Array(vertices.length * 3);
    vertices.forEach((v, i) => {
      flat[i * 3] = v.x;
      flat[i * 3 + 1] = v.y;
      flat[i * 3 + 2] = v.z;
    });
    const packed = { ...rest, vertices: flat, indices: Uint32Array.from(indices) };
    transfer.push(packed.vertices.buffer, packed.indices.buffer);
    return packed;
  });
  const { statics, staticSurfaces, staticConveyors, launchPads, volumes, gatedFloors = [] } = resolved;
  return { world: { statics, staticSurfaces, staticConveyors, launchPads, volumes, gatedFloors, staticTrimeshes }, transfer };
};

/** {@link packBotStillWorld} undone, on the worker. */
export const unpackBotStillWorld = (world: PackedBotStillWorld): BotStillWorld => ({
  ...world,
  staticTrimeshes: world.staticTrimeshes.map(({ vertices, indices, ...rest }) => {
    const corners = new Array<{ x: number; y: number; z: number }>(vertices.length / 3);
    for (let i = 0; i < corners.length; i += 1) corners[i] = { x: vertices[i * 3]!, y: vertices[i * 3 + 1]!, z: vertices[i * 3 + 2]! };
    return { ...rest, vertices: corners, indices: Array.from(indices) };
  }),
});

const botTrackOf = (resolved: ResolvedTrack, nav: TrackNav): BotTrack => ({
  resolved,
  nav,
  targets: raceTargets(resolved.checkpoints, resolved.finishZones),
  forks: new Map(),
  moving: movingWorldOf(resolved, nav),
});

/** Frees the navmesh a {@link BotTrack} holds. Called when its world is replaced. */
export const disposeBotTrack = (track: BotTrack): void => disposeTrackNav(track.nav);

/**
 * Everything a Bot may read, for one Tick (M17 ticket 03). It is what the
 * authority already knows as of the last Tick simulated, as plain data: a Bot
 * never holds the simulation itself, so nothing it does can write state. Its
 * only way to act is the {@link SimInputs} it returns, the same record a
 * Player's client sends (ADR 0002/0003).
 */
export interface BotWorldView {
  /** The Tick this Bot's input is for. The world below is as of the Tick before it. */
  readonly tick: number;
  /** This Bot's own Character's id. */
  readonly id: string;
  /** This Bot's own Character. */
  readonly self: Readonly<CharacterSnapshot>;
  /** Every Character in the Round, this Bot's own included: poses, motion states, progress. */
  readonly characters: Readonly<Record<string, Readonly<CharacterSnapshot>>>;
  /**
   * Every Prop's pose, in `SimState.props`' order, which is
   * `track.resolved.props`' order too (M17 ticket 09): who carries it, whether
   * it flies. What a Prop weighs and whether it is a Bomb is the Track's, on
   * `track.resolved.props`. Absent where nothing was given: a Bot then sees no
   * Prop at all.
   */
  readonly props?: readonly Readonly<PropSnapshot>[] | undefined;
  /** Every Bomb that is lit or spent, as the Snapshot carries them (`SimState.bombs`, ADR 0126). Absent or empty: none is. */
  readonly bombs?: readonly Readonly<BombState>[] | undefined;
  readonly track: BotTrack;
  /** This Round's rules (ADR 0041), what the Round is about. */
  readonly rules: Readonly<RoundRules>;
  /**
   * The Motion Clock (ADR 0123): the Tick the Round runs from, or `null`
   * before it runs (M17 ticket 07). Never delayed: it is the Round's own,
   * like `tick`. Absent where nothing was given (every view built before this
   * ticket), which reads as `null`: no Ramp runs.
   */
  readonly runningFromTick?: MotionClock;
  /**
   * Every fragile floor that is not intact (`SimState.fragile`, ADR 0118).
   * Delayed with `self`/`characters` by `withPerceptionDelay`. Absent or
   * empty: all intact.
   */
  readonly fragile?: readonly Readonly<FragileState>[] | undefined;
}

/**
 * A Character's driver that is not a human (CONTEXT.md: Bot, ADR 0129): it
 * turns a view of the world into one input a Tick. It runs only where the
 * authority runs, and a client never runs or predicts one.
 *
 * `think` is called every Tick and must return an input every Tick, because
 * steering is continuous. What it decides (where to go, whether to fight) may
 * change more slowly than that: a Bot keeps its decisions between calls.
 * Anything random in a Bot comes from a seeded generator, never
 * `Math.random()`, so a suite's Bot plays the same every run.
 */
export interface Bot {
  think(view: BotWorldView): SimInputs;
}
