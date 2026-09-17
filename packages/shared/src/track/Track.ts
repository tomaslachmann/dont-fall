import { orientBox, type Box, type OrientedBox } from "../math/box.js";
import { conjugateQuat, eulerQuat, IDENTITY_QUAT, mulQuat, quatToEuler, yawQuat, type Quat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, scaleVec3, subVec3, type Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { FinishZone } from "../simulation/FinishZone.js";
import type { LaunchPadConfig } from "../simulation/LaunchPad.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { MovingSegmentConfig } from "../simulation/MovingSegment.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";
import type { VolumeConfig } from "../simulation/Volume.js";
import type { EnvironmentId } from "./Environment.js";
import { findSocket, type Hazard, type Module, type Socket } from "./Module.js";
import {
  conveyorWorldVelocity,
  DEPRECATED_MODULE_IDS,
  type ConveyorBelt,
  type DeckFrame,
  type SegmentConveyor,
} from "./Conveyor.js";
import { ICE_SURFACE_ID, moduleHasIceSurface, type IceDeck } from "./IceOverlay.js";
import { moduleHasMudSurface, MUD_SURFACE_ID, type MudDeck } from "./MudOverlay.js";
import { BOUNCE_SURFACE_ID, moduleHasBounceSurface, type BounceDeck } from "./BounceOverlay.js";
import { launchHeightOf, launchVelocityFor, type SegmentLaunch } from "./Launch.js";
import { hasMotion, type SegmentMotion } from "./Motion.js";
import {
  floorBelow,
  isCheckpointGate,
  RESPAWN_ABOVE_FLOOR,
  respawnProbeOrigins,
  startSegmentIndex,
  type SegmentCheckpoint,
} from "./Course.js";
import { placeGate, type PlacedGate } from "./Gate.js";
import type { SolidShape } from "./asset.js";
import { DEFAULT_SURFACE, type SurfaceId } from "./Surface.js";

/**
 * One placed instance of a Module in a Track (CONTEXT.md: Segment).
 * `rotation` (radians, world yaw) is the same field this has always had.
 * `pitch`/`roll` (radians, ADR 0034) are additive and optional, defaulting to
 * 0 — every Revision published before ADR 0034 (including the M1 seed) has
 * neither field and resolves identically to before. Together the three
 * compose a full 3D orientation ({@link segmentOrientation}); no longer
 * restricted to a multiple of 90° (ADR 0031's restriction existed only
 * because the old placement scheme pre-rotated an axis-aligned box by hand
 * instead of giving `RapierSimulation` a real rotated collider).
 *
 * `manuallyPlaced` (ticket 02) is a pure Track-builder authoring concern —
 * `resolveTrack`/`RapierSimulation`/the Match server never read it, a Segment
 * always just has whatever position/orientation it has. It exists so the
 * builder's `rechainFrom` (auto-recompute from the socket chain) can skip a
 * Segment the author has explicitly moved/rotated by hand, rather than
 * silently overwriting it on the next unrelated edit. Lives on `Segment`
 * itself (not a side-table keyed by index) so it naturally survives
 * insert/delete/reorder and undo/redo along with the Segment it describes.
 */
export interface Segment {
  moduleId: string;
  position: Vec3;
  rotation: number;
  pitch?: number;
  roll?: number;
  manuallyPlaced?: boolean;
  /**
   * How this Segment moves, if it does (ADR 0061) — additive and optional
   * like `pitch`/`roll`, so every Track stored before it reads unchanged.
   * Applied in the Segment's local frame, before its placement.
   */
  motion?: SegmentMotion;
  /**
   * Uniform size (ADR 0062) — additive and optional, 1 when absent. The
   * innermost part of the placement, wrapping the Motion: a rest-local point
   * `p` is at `position + orientation·(scale · motion(p))`, so geometry,
   * Footprint, Sockets, triggers and the Motion's pivots and offsets all grow
   * together.
   */
  scale?: number;
  /**
   * The belt attached to this Segment, if any (CONTEXT.md: Conveyor, ADR
   * 0064) — the whole asset carries whoever stands on it. Additive and
   * optional like `motion`/`scale`, so every Track stored before it reads
   * unchanged.
   */
  conveyor?: SegmentConveyor;
  /**
   * Ice attached to this Segment (ADR 0066) — the whole deck skates, like a
   * belt's whole-deck carry but for grip instead of flow. Exactly `true`
   * when present (detaching removes the key); additive and optional like
   * `conveyor`, so every Track stored before it reads unchanged. Supersedes
   * the retired `ice` Module, which old Tracks keep resolving.
   */
  ice?: boolean;
  /**
   * Mud attached to this Segment (ADR 0067) — the whole deck drags, the
   * grip mirror of attached ice. Exactly `true` when present (detaching
   * removes the key); additive and optional like `ice`. Mutually exclusive
   * with `ice` (publish refuses the pair — one deck, one Surface);
   * supersedes the retired `mud` Module, which old Tracks keep resolving.
   */
  mud?: boolean;
  /**
   * An inflatable bounce sheet attached to this Segment (ADR 0070) — exactly
   * `true` when present, the third member of ice and mud's one-deck-one-
   * Surface choice. Additive and optional like they are.
   */
  bounce?: boolean;
  /**
   * How high this Spring throws (CONTEXT.md: Spring, ADR 0069) — an override
   * of the Asset's own default, in metres. Additive and optional like
   * `conveyor`/`mud`; ignored on a Module that is not a Spring, and a Spring
   * without one still launches.
   */
  launch?: SegmentLaunch;
  /**
   * This Segment is the Track's Start (CONTEXT.md: Start, ADR 0068) — exactly
   * `true` when present, on one Segment at most. A Track without one starts
   * on its first Segment.
   */
  start?: boolean;
  /**
   * A hoop or an arch switched on as a Checkpoint (ADR 0068) — its number and,
   * when chosen, its respawn spot. Ignored on any other Module.
   */
  checkpoint?: SegmentCheckpoint;
}

/** A solid part's shape at `scale` (ADR 0062/0063). */
export const scaleSolidShape = (shape: SolidShape, scale: number): SolidShape => {
  if (scale === 1) return shape;
  switch (shape.type) {
    case "ball":
      return { type: "ball", radius: shape.radius * scale };
    case "capsule":
    case "cylinder":
      return { type: shape.type, halfHeight: shape.halfHeight * scale, radius: shape.radius * scale };
    case "box":
      return { type: "box", halfExtents: scaleVec3(shape.halfExtents, scale) };
    case "hull":
      return { type: "hull", points: shape.points.map((p) => scaleVec3(p, scale)) };
  }
};

/** A Segment's uniform scale (ADR 0062), 1 when it has none. */
export const segmentScale = (segment: Pick<Segment, "scale">): number => segment.scale ?? 1;

/** `box` at `scale` about its Module's origin — centre and half-extents together. */
export const scaleBox = <B extends Box>(box: B, scale: number): B =>
  scale === 1 ? box : { ...box, center: scaleVec3(box.center, scale), halfExtents: scaleVec3(box.halfExtents, scale) };

/**
 * The per-Segment warning for a retired Module id: pads lost their behaviour
 * to the Segment Conveyor (ADR 0064), while ice/mud keep their Surface and
 * only their authoring moved to the Segment (ADR 0066/0067) — an old Track
 * must grip exactly where it always did. Each names the fix.
 */
const retiredModuleWarning = (segmentIndex: number, moduleId: string): string => {
  const courseFix: Record<string, string> = {
    start: "mark any Segment as the Start instead",
    finish: "place a finish sign instead",
    sandbox: "place a finish sign instead",
    "checkpoint-spinner": "switch a hoop or an arch on as a Checkpoint instead",
    "checkpoint-end-props": "switch a hoop or an arch on as a Checkpoint instead",
  };
  if (courseFix[moduleId]) {
    return `Segment ${segmentIndex} references retired block "${moduleId}": ${courseFix[moduleId]} (ADR 0068) — it still works for now`;
  }
  if (moduleId === "ice" || moduleId === "mud") {
    return (
      `Segment ${segmentIndex} references retired Module "${moduleId}": ` +
      `attach ${moduleId} to the Segment instead — this Segment keeps its ${moduleId} for now`
    );
  }
  if (moduleId === "updraft") {
    return (
      `Segment ${segmentIndex} references retired Module "updraft": ` +
      "place a fan instead — this Segment keeps its deck, but the air is gone"
    );
  }
  return (
    `Segment ${segmentIndex} references retired Module "${moduleId}": ` +
    "its pad no longer fires — attach a Conveyor to the Segment instead"
  );
};

/**
 * The deck a Segment's overlays sit on (ADR 0064/0066/0067): its footprint
 * frame on the top of its own collision, measured in the Module's frame and
 * then placed with the whole Segment — so a pitched or rolled deck's overlay
 * lies in the deck's plane, where a belt visibly runs and an ice/mud sheet
 * lies. (The highest *world* point of a ramp is its top edge, and a flat
 * sheet there floats over the rest of it.) Moving Segments resolve at the
 * rest pose like everything else of theirs; the game client re-parents the
 * overlay under the Segment's own group so it follows the Motion.
 */
const deckFrame = (segment: Segment, module: Module, scale: number, orientation: Quat): DeckFrame => {
  let top = 0;
  for (const box of module.statics) top = Math.max(top, box.center.y + box.halfExtents.y);
  for (const mesh of module.asset?.meshes ?? []) {
    for (const p of mesh.positions) top = Math.max(top, p.y);
  }
  const { center, halfExtents } = module.footprint.bounds;
  return {
    center: addVec3(rotateVec3ByQuat(scaleVec3({ x: center.x, y: top, z: center.z }, scale), orientation), segment.position),
    yaw: segment.rotation,
    orientation,
    halfX: halfExtents.x * scale,
    halfZ: halfExtents.z * scale,
  };
};

/** A Track: an ordered sequence of Segments (CONTEXT.md). */
export type Track = Segment[];

/**
 * How many checkpoints a Track crosses — one per Segment whose Module
 * authors one (a Module carries at most one `checkpoint`). What the
 * Countdown's `CHECKPOINT 00 / N` counts down from. A Segment referencing
 * an unknown Module counts zero here; `buildTrack` owns that validation
 * and throws at boot, this is a label, not a load.
 */
export const countCheckpoints = (track: Track, modules: Record<string, Module>): number =>
  track.filter((segment) => modules[segment.moduleId]?.checkpoint !== undefined || isCheckpointGate(segment, modules)).length;

/**
 * Whether `track` carries a Finish Zone anywhere (M9 ticket 16) — true when
 * any placed Segment's Module authors one. The listing's cheap answer to
 * the question `resolveTrack(...).finishZones.length > 0` answers
 * expensively: no geometry is placed, only Module authorship is read, which
 * is all raceability ever depended on. Lenient like {@link countCheckpoints}
 * (a Segment referencing an unknown Module contributes nothing instead of
 * throwing) for the same reason: this is a label, not a load — a listing
 * must never 500 because one stored Track references a since-removed
 * Module, and such a Track can't load (and so can't be raced) anyway.
 */
export const trackHasFinishZone = (track: Track, modules: Record<string, Module>): boolean =>
  track.some((segment) => {
    const module = modules[segment.moduleId];
    return module?.finishZone !== undefined || (module?.gate?.role === "finish" && !hasMotion(segment.motion));
  });

/**
 * The Thumbnail (CONTEXT.md) contract — one JPEG screenshot per Revision,
 * captured in the Track builder's capture mode and shown in Discover and the
 * Round loader (ADR 0085). Fixed frame and encoding on every side, so the
 * builder captures, the API validates, and the clients lay out against the
 * same numbers without a second declaration to drift.
 */
/** A captured Thumbnail's frame — 16:9, the Discover card's own aspect family. */
export const TRACK_THUMBNAIL_WIDTH = 1280;
export const TRACK_THUMBNAIL_HEIGHT = 720;
/** Thumbnails are always JPEG — a photo of a 3D scene, never line art. */
export const TRACK_THUMBNAIL_MIME = "image/jpeg";
/** The data-URL prefix every stored Thumbnail carries (`<prefix><base64>`). */
export const TRACK_THUMBNAIL_DATA_URL_PREFIX = "data:image/jpeg;base64,";
/**
 * The longest stored data URL, in characters — ~1 MB, several times a
 * 1280×720 q0.85 JPEG, so a busy scene never trips it and a garbage upload
 * still can't bloat a Revision row without bound.
 */
export const MAX_TRACK_THUMBNAIL_CHARS = 1_000_000;

/**
 * One row of the API's `GET /tracks` listing (ticket 09/ADR 0032) — a
 * Track's id/name/author/createdAt without its full Segment data, plus the
 * two facts Discover's category tabs filter and sort on (M9 ticket 16):
 * how often the Track has been played, and whether a Race can run on it at
 * all. Shared between the API (the producer) and the Track builder (the
 * consumer) so the two never silently drift apart (code review, ticket 09 —
 * this used to be declared separately in each).
 */
export interface TrackListing {
  id: string;
  name: string | null;
  authorId: string;
  createdAt: number;
  /**
   * Whether the latest Revision carries a Thumbnail (ADR 0085) — the bytes
   * themselves never ride the listing (one JPEG per row would drown it);
   * clients that need them fetch `GET /tracks/:id/thumbnail`.
   */
  hasThumbnail: boolean;
  /**
   * Rounds ever started on this Track (M9 ticket 16) — an anonymous counter,
   * no per-Account data. Feeds TRENDING's sort and nothing else.
   */
  plays: number;
  /**
   * Whether the latest Revision carries a Finish Zone (M9 ticket 16) — the
   * same derived fact `roundStartBlockedReason` already reads, computed
   * against the current Module library on every listing so it can never
   * disagree with what the server itself would refuse. Not a Round-type tag
   * (ADR 0041 forbids those): a Track with no Finish Zone still hosts
   * Survival, it just can't be raced.
   */
  hasFinishZone: boolean;
}

/** Display name for a Track whose Revision carries none (or is gone) — one spelling, every surface. */
export const UNTITLED_TRACK_NAME = "UNTITLED TRACK";

/**
 * One stored Track Revision, in full — the API's own `GET /tracks/:id`
 * response shape (M4.5 ticket 04). Shared for the same reason as
 * `TrackListing`: the API (the producer) and the Track builder (the
 * consumer, previously `StoredTrackResponse` — a hand-written subset that
 * silently dropped `revision`/`authorId`/`contentHash`, which the wire
 * always carried) must agree on this without a second declaration to drift.
 */
export interface StoredTrack extends TrackRoundDefaults {
  id: string;
  name: string | null;
  track: Track;
  revision: number;
  authorId: string;
  contentHash: string;
  /**
   * The Environment this Revision is drawn inside (ADR 0074). A sibling of
   * the Round defaults, never one of them: it is not a Round default, and the
   * Match server never reads it. A client reads it through
   * `resolveEnvironmentId`, since a newer API may name a preset it lacks.
   */
  environment: EnvironmentId;
  /**
   * Whether this Revision carries a Thumbnail (ADR 0085) — presentation only
   * like `environment`, and the Match server never reads it either. The bytes
   * live behind `GET /tracks/:id/thumbnail`, never on this shape.
   */
  hasThumbnail: boolean;
}

/**
 * The Round defaults a Track Revision carries (ADR 0041) — the "Track
 * defaults" half of `resolveRoundRules`, authored in the Track builder and
 * written with the Revision.
 *
 * Deliberately not a `RoundRules`: a Track carries no `fallBehavior` opinion
 * at all, because nothing tags a Track with the Round types it allows (ADR
 * 0041). These are the numbers a Round uses *if* a Lobby runs that kind of
 * Round here — `survivorTarget` says nothing about whether this Track will
 * ever host Survival, the same way a Finish Zone says nothing about whether
 * it will ever be raced.
 *
 * Named once and shared by everything that moves the pair around — the
 * stored Revision, the builder's publish, the Match server's fetch — so a
 * field added here can't be silently dropped by one of the three.
 */
export interface TrackRoundDefaults {
  /** How long a Round on this Revision gets, in ms (M4 ticket 03, ADR 0038). */
  timeLimitMs: number;
  /**
   * How many Players a Survival Round on this Revision leaves standing
   * before it ends (M5 ticket 07). A Race never reads it.
   */
  survivorTarget: number;
}

/** A Segment's full 3D orientation as one quaternion (ADR 0034) — composes its yaw/pitch/roll fields. */
export const segmentOrientation = (segment: Pick<Segment, "rotation" | "pitch" | "roll">): Quat =>
  eulerQuat(segment.rotation, segment.pitch ?? 0, segment.roll ?? 0);

/**
 * One asset Module's collision mesh in world space (M8 ticket 02) — the
 * trimesh half of what `resolveTrack` returns. `statics`/`staticSurfaces`
 * stay the box half; the two never mix within one Module (one carrying
 * both is refused), and `RapierSimulation` consumes both through the same
 * `staticSurfaceByHandle` machinery, never a parallel one.
 */
export interface StaticTrimesh {
  vertices: Vec3[];
  indices: number[];
  surface: SurfaceId;
  /** The owning Module's hazard, if any (ADR 0061). */
  hazard?: Hazard;
  /** World-space belt flow, when the owning Segment carries a Conveyor (ADR 0064). */
  conveyor?: Vec3;
}

/** A Socket's full local orientation as one quaternion (ADR 0034) — composes its yaw/pitch/roll fields. */
const socketOrientation = (socket: Pick<Socket, "yaw" | "pitch" | "roll">): Quat =>
  eulerQuat(socket.yaw, socket.pitch ?? 0, socket.roll ?? 0);

/** Below the noise floor of `eulerQuat`/`quatToEuler`'s own float error — treated as exactly 0 (an untilted Segment). */
const PITCH_ROLL_EPSILON = 1e-9;

/**
 * Places `moduleId` right after `prev` by aligning `nextModule`'s `entrySocketId`
 * Socket against `prevModule`'s `exitSocketId` Socket (ADR 0031) — the two
 * Sockets end up at the same world position, facing each other (180° apart).
 *
 * Generalized to a full 3D orientation (ADR 0034):
 * 1. `exitWorldOrientation` — the exit Socket's orientation composed into
 *    world space: `prev`'s own orientation, then the Socket's local one.
 * 2. The entry Socket must face the exact opposite way, so the next
 *    Segment's orientation is `exitWorldOrientation`, turned 180° around its
 *    own local up, with the entry Socket's local orientation un-composed
 *    back out (so the entry Socket itself — not the Segment's own origin —
 *    is what lands on the exit Socket).
 *
 * This is the direct quaternion generalization of the old
 * `nextYaw = exitWorldYaw + π - entry.yaw` arithmetic — for yaw-only Sockets
 * (every Socket authored before ADR 0034) the two formulas agree exactly,
 * which is what keeps `M1_TRACK` chaining to the identical positions it
 * always has (pinned by this package's `Track.test.ts`).
 */
export const placeAfter = (
  prev: Segment,
  prevModule: Module,
  moduleId: string,
  nextModule: Module,
  exitSocketId = "exit",
  entrySocketId = "entry",
  /** The placed Segment's own scale (ADR 0062) — its entry Socket sits that much farther from its origin. */
  nextScale = 1,
): Segment => {
  const exit = findSocket(prevModule, exitSocketId);
  const entry = findSocket(nextModule, entrySocketId);

  const prevOrientation = segmentOrientation(prev);
  const exitLocalOrientation = socketOrientation(exit);
  const exitWorldOrientation = mulQuat(prevOrientation, exitLocalOrientation);
  const exitWorldPos = addVec3(prev.position, rotateVec3ByQuat(scaleVec3(exit.position, segmentScale(prev)), prevOrientation));

  const entryLocalOrientation = socketOrientation(entry);
  const nextOrientation = mulQuat(mulQuat(exitWorldOrientation, yawQuat(Math.PI)), conjugateQuat(entryLocalOrientation));
  const nextPos = subVec3(exitWorldPos, rotateVec3ByQuat(scaleVec3(entry.position, nextScale), nextOrientation));

  const { yaw, pitch, roll } = quatToEuler(nextOrientation);
  return {
    moduleId,
    position: nextPos,
    rotation: yaw,
    ...(Math.abs(pitch) > PITCH_ROLL_EPSILON ? { pitch } : {}),
    ...(Math.abs(roll) > PITCH_ROLL_EPSILON ? { roll } : {}),
    ...(nextScale !== 1 ? { scale: nextScale } : {}),
  };
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

/**
 * Where the `index`-th joining Character spawns: a grid laid out in the
 * *first* Segment's own frame (position + full orientation), so the spawn
 * follows the start platform wherever free placement puts it — independent of
 * world x-y-z. Players are solid to each other, so joiners must never share a
 * spot: 4 across, wrapping after 12 (the ADR 0011 player ceiling), same slots
 * `playgroundSpawn` used when the first Segment sat at M1's origin.
 *
 * The local offsets are M1's own grid expressed relative to its start Segment
 * (`chainTrack(..., { x: 0, y: 0, z: 10 })`, rotation 0): x −1.8…1.8 clear of
 * the x = −3.2 wall, y 1.2 above the deck, z 0.5 back across the platform.
 * For M1 itself this returns exactly `playgroundSpawn(index)`.
 */
export const trackSpawn = (track: Track, index: number, modules?: Record<string, Module>): Vec3 => {
  const slot = ((index % 12) + 12) % 12;
  const col = slot % 4; // 4 across
  const row = Math.floor(slot / 4); // up to 3 back
  const startIndex = startSegmentIndex(track);
  const start = startIndex === undefined ? undefined : track[startIndex]!;
  const startModule = start && modules?.[start.moduleId];
  if (start && startModule) {
    // The Start (ADR 0068): the same grid, centred on its deck and squeezed to
    // fit a small piece down to a Player's width, facing its forward (−Z).
    const deck = deckFrame(start, startModule, segmentScale(start), segmentOrientation(start));
    const across = Math.min(SPAWN_SPACING_ACROSS, Math.max(SPAWN_SPACING_MIN, (2 * deck.halfX) / 4));
    const back = Math.min(SPAWN_SPACING_BACK, Math.max(SPAWN_SPACING_MIN, (2 * deck.halfZ) / 3));
    const offset = rotateVec3ByQuat({ x: (col - 1.5) * across, y: 0, z: (row - 1) * back }, yawQuat(start.rotation));
    return { x: deck.center.x + offset.x, y: deck.center.y + SPAWN_ABOVE_DECK, z: deck.center.z + offset.z };
  }
  const local: Vec3 = { x: -1.8 + col * 1.2, y: 1.2, z: 0.5 - row * 1.5 };
  const first = start ?? track[0];
  if (!first) return { ...local, z: local.z + 10 };
  // Only the height follows a scaled first piece (ADR 0062): its deck moves up
  // or down with it, but Players stay a Player's width apart at any size.
  const scaled = { ...local, y: local.y * segmentScale(first) };
  return addVec3(first.position, rotateVec3ByQuat(scaled, segmentOrientation(first)));
};

/** The spawn grid's spacing on a Start (ADR 0068): M1's own, squeezed no tighter than a Player's width. */
const SPAWN_SPACING_ACROSS = 1.2;
const SPAWN_SPACING_BACK = 1.5;
const SPAWN_SPACING_MIN = 0.8;
/** A spawned capsule centre above the deck — M1's 1.2. */
const SPAWN_ABOVE_DECK = 1.2;

/**
 * The camera yaw Players start with (ADR 0068): looking along the Start's
 * forward — `undefined` without a Start. A Segment's yaw θ turns its forward
 * (−Z) to `(−sin θ, 0, −cos θ)`, the camera's yaw φ looks along
 * `(sin φ, 0, −cos φ)` (`movementDirection`), so φ = −θ.
 */
export const trackSpawnYaw = (track: Track): number | undefined => {
  const index = startSegmentIndex(track);
  return index === undefined ? undefined : -track[index]!.rotation;
};

/**
 * Every gate Checkpoint a Track counts, in run order, placed — with the spots
 * its default Respawn floor is probed from (ADR 0068,
 * {@link respawnProbeOrigins}): in front of the gate as seen from the stop
 * before it (the previous Checkpoint, else the spawn), then behind it. Shared
 * by `resolveTrack` and the builder's preview so both look in the same places.
 * Switched-on gates off a hoop or an arch, or moving, aren't here.
 */
export const gateCheckpointPlans = (
  track: Track,
  modules: Record<string, Module>,
): { segmentIndex: number; order: number; gate: PlacedGate; probes: Vec3[]; respawn?: Vec3 }[] => {
  const entries = track
    .flatMap((segment, segmentIndex) => {
      const module = modules[segment.moduleId];
      if (!segment.checkpoint || module?.gate?.role !== "checkpoint" || hasMotion(segment.motion)) return [];
      const orientation = segmentOrientation(segment);
      const scale = segmentScale(segment);
      const place = (p: Vec3): Vec3 => addVec3(rotateVec3ByQuat(scaleVec3(p, scale), orientation), segment.position);
      return [
        {
          segmentIndex,
          order: segment.checkpoint.order,
          gate: placeGate(module.gate.opening, segment.position, orientation, scale),
          footprint: orientBox(scaleBox(module.footprint.bounds, scale), segment.position, orientation),
          ...(segment.checkpoint.respawn === undefined ? {} : { respawn: place(segment.checkpoint.respawn) }),
        },
      ];
    })
    .sort((a, b) => a.order - b.order || a.segmentIndex - b.segmentIndex);
  // The stop a runner arrives from: a retired block's Checkpoint comes first in run order, else the spawn.
  const lastBlock = [...track.entries()].reverse().find(([, segment]) => modules[segment.moduleId]?.checkpoint);
  let arrivingFrom: Vec3 = lastBlock
    ? addVec3(
        rotateVec3ByQuat(scaleVec3(modules[lastBlock[1].moduleId]!.checkpoint!.respawn, segmentScale(lastBlock[1])), segmentOrientation(lastBlock[1])),
        lastBlock[1].position,
      )
    : trackSpawn(track, 0, modules);
  return entries.map(({ footprint, ...entry }) => {
    const probes = respawnProbeOrigins(entry.gate, footprint, arrivingFrom);
    arrivingFrom = entry.gate.center;
    return { ...entry, probes };
  });
};

/**
 * Flattens a Track into the world-space geometry `RapierSimulation`/the
 * scene consume. `staticSurfaces` is index-aligned with `statics` — entry
 * `i` is the Surface `statics[i]`'s owning FloorBox collapses to
 * (`FloorBox.surface ?? Module.surface ?? "default"`, ADR 0036), resolved
 * here once rather than in the tick loop. `staticConveyors` is the same
 * idea for belts (ADR 0064): entry `i` is the world-space flow
 * `statics[i]`'s owning Segment runs, or `undefined` for the ordinary
 * still floor almost every box is.
 */
export const resolveTrack = (
  modules: Record<string, Module>,
  track: Track,
): {
  statics: OrientedBox[];
  staticSurfaces: SurfaceId[];
  staticConveyors: (Vec3 | undefined)[];
  /** World-space asset collision, index-aligned with nothing — each entry carries its own Surface (M8 ticket 02). */
  staticTrimeshes: StaticTrimesh[];
  props: PropConfig[];
  spinners: SpinnerConfig[];
  checkpoints: Checkpoint[];
  /**
   * Every Finish Zone the Track's Segments carry, in Track order (M4 ticket
   * 02, ADR 0039) — plural here and singular on the Module for exactly the
   * same reason `checkpoints`/`checkpoint` are: a Module authors at most one,
   * a Track can place several Modules that each have one. Empty for a Track
   * that has no Finish Zone at all, which is simply not raceable yet.
   */
  finishZones: FinishZone[];
  launchPads: LaunchPadConfig[];
  /**
   * Which Segment each entry of `launchPads` came from, index-aligned with it
   * (ADR 0069) — the same bookkeeping `staticOwners`/`trimeshOwners` do for
   * the gate floor probe. Renderers only: it is what lets a client squash the
   * Spring that actually fired. Nothing that simulates reads it.
   */
  launchPadOwners: number[];
  volumes: VolumeConfig[];
  /**
   * Every Segment with a Motion (ADR 0061), its collision kept in local space
   * for one kinematic body — and therefore absent from `statics` and
   * `staticTrimeshes`. What it authors besides collision (Checkpoint, pads,
   * Finish Zone, Volumes, Props, Spinners) still resolves at the rest pose.
   */
  movingSegments: MovingSegmentConfig[];
  /** Every attached belt, for the renderers — physics reads belts off ground colliders, never this (ADR 0064). */
  conveyors: ConveyorBelt[];
  /** Every ice-surfaced deck, for the renderers — physics reads the Surface off ground colliders, never this (ADR 0066). */
  iceDecks: IceDeck[];
  /** Every mud-surfaced deck, for the renderers — same contract as `iceDecks` (ADR 0067). */
  mudDecks: MudDeck[];
  /** Every bouncy deck, for the renderers — same contract again (ADR 0070). */
  bounceDecks: BounceDeck[];
  /**
   * One human-readable line per Segment that references a retired Module
   * (ADR 0064) — the Track still loads (the geometry was always an ordinary
   * platform), but the author should re-attach the pad as a Conveyor. Empty
   * for every Track authored after the retirement.
   */
  warnings: string[];
} => {
  const statics: OrientedBox[] = [];
  const staticSurfaces: SurfaceId[] = [];
  const staticConveyors: (Vec3 | undefined)[] = [];
  const staticTrimeshes: StaticTrimesh[] = [];
  const props: PropConfig[] = [];
  const spinners: SpinnerConfig[] = [];
  const checkpoints: Checkpoint[] = [];
  const finishZones: FinishZone[] = [];
  const launchPads: LaunchPadConfig[] = [];
  const launchPadOwners: number[] = [];
  const volumes: VolumeConfig[] = [];
  const movingSegments: MovingSegmentConfig[] = [];
  const conveyors: ConveyorBelt[] = [];
  const iceDecks: IceDeck[] = [];
  const mudDecks: MudDeck[] = [];
  const bounceDecks: BounceDeck[] = [];
  const warnings: string[] = [];
  // Which Segment each still collider came from — a gate's floor probe skips its own.
  const staticOwners: number[] = [];
  const trimeshOwners: number[] = [];

  for (const [segmentIndex, segment] of track.entries()) {
    const module = modules[segment.moduleId];
    if (!module) throw new Error(`Track references unknown Module "${segment.moduleId}"`);
    if (DEPRECATED_MODULE_IDS.has(segment.moduleId)) {
      warnings.push(retiredModuleWarning(segmentIndex, segment.moduleId));
    }

    const orientation = segmentOrientation(segment);
    const scale = segmentScale(segment);
    const placeBox = (box: Box): OrientedBox => orientBox(scaleBox(box, scale), segment.position, orientation);
    const placePoint = (point: Vec3): Vec3 => addVec3(rotateVec3ByQuat(scaleVec3(point, scale), orientation), segment.position);
    const belt = segment.conveyor ? conveyorWorldVelocity(segment.conveyor, segment.rotation) : undefined;
    // An attached Surface (ADR 0066/0067) wins over every authored Surface
    // on its Segment — the attachment says "this whole deck skates/drags",
    // like a belt's whole-deck carry, so per-box overrides don't survive
    // it. Publish refuses an ice+mud pair (one deck, one Surface); if one
    // arrives anyway on an unvalidated Track, mud wins — its opaque raised
    // sheet is the visible top layer, so physics matches what the eye sees.
    const segmentIce = segment.ice === true;
    const segmentMud = segment.mud === true;
    const segmentBounce = segment.bounce === true;
    // Bounce first in the tie-break for the same reason mud beats ice: its
    // sheet is the visible top layer, and a deck that looks inflatable had
    // better throw you.
    const attachedSurface = segmentBounce
      ? BOUNCE_SURFACE_ID
      : segmentMud
        ? MUD_SURFACE_ID
        : segmentIce
          ? ICE_SURFACE_ID
          : undefined;

    if (module.asset && module.statics.length > 0) {
      throw new Error(`Module "${module.id}" carries both statics and asset geometry — exactly one may describe its collision`);
    }

    if (hasMotion(segment.motion)) {
      movingSegments.push({
        segmentIndex,
        moduleId: segment.moduleId,
        position: segment.position,
        orientation,
        scale,
        motion: segment.motion,
        boxes: module.statics.map((box) => ({
          box: scaleBox(box, scale),
          surface: attachedSurface ?? (box.surface ?? module.surface ?? DEFAULT_SURFACE),
          ...(belt === undefined ? {} : { conveyor: belt }),
        })),
        solids: (module.asset?.solid ?? []).map((part) => ({
          shape: scaleSolidShape(part.shape, scale),
          position: scaleVec3(part.position, scale),
          rotation: part.rotation,
          surface: attachedSurface ?? part.surface,
          ...(module.hazard === undefined ? {} : { hazard: module.hazard }),
          ...(belt === undefined ? {} : { conveyor: belt }),
        })),
        // A hollow trimesh only when the Asset has no solid parts (a file from before ADR 0065).
        trimeshes: (module.asset?.solid?.length ? [] : (module.asset?.meshes ?? [])).map((mesh) => ({
          vertices: scale === 1 ? mesh.positions : mesh.positions.map((p) => scaleVec3(p, scale)),
          indices: mesh.indices,
          surface: attachedSurface ?? (mesh.surface ?? module.surface ?? DEFAULT_SURFACE),
          ...(module.hazard === undefined ? {} : { hazard: module.hazard }),
          ...(belt === undefined ? {} : { conveyor: belt }),
        })),
      });
    }

    for (const box of hasMotion(segment.motion) ? [] : module.statics) {
      statics.push(placeBox(box));
      staticOwners.push(segmentIndex);
      staticSurfaces.push(attachedSurface ?? (box.surface ?? module.surface ?? DEFAULT_SURFACE));
      staticConveyors.push(belt);
    }

    if (module.asset && !hasMotion(segment.motion)) {
      for (const mesh of module.asset.meshes) {
        trimeshOwners.push(segmentIndex);
        staticTrimeshes.push({
          vertices: mesh.positions.map((p) => placePoint(p)),
          indices: [...mesh.indices],
          surface: attachedSurface ?? (mesh.surface ?? module.surface ?? DEFAULT_SURFACE),
          ...(module.hazard === undefined ? {} : { hazard: module.hazard }),
          ...(belt === undefined ? {} : { conveyor: belt }),
        });
      }
    }

    if (belt !== undefined) {
      conveyors.push({
        segmentIndex,
        velocity: belt,
        deck: deckFrame(segment, module, scale, orientation),
      });
    }

    if (segmentIce || moduleHasIceSurface(module)) {
      iceDecks.push({ segmentIndex, deck: deckFrame(segment, module, scale, orientation) });
    }

    if (segmentMud || moduleHasMudSurface(module)) {
      mudDecks.push({ segmentIndex, deck: deckFrame(segment, module, scale, orientation) });
    }

    if (segmentBounce || moduleHasBounceSurface(module)) {
      bounceDecks.push({ segmentIndex, deck: deckFrame(segment, module, scale, orientation) });
    }

    // Props don't yet carry an initial rotation of their own (`PropConfig`
    // has no orientation field — every Prop always spawns axis-aligned and
    // only tumbles from live simulation afterward). A tilted Segment's Prop
    // is positioned correctly but not yet shape-tilted — a known limitation
    // to lift once Props gain a real spawn orientation, not attempted here
    // (a separate feature, not this ticket's static-collider scope).
    //
    // Code review, ticket 01: this is a real (if currently latent) step back
    // for an oblong Prop specifically at a 90°/270°-rotated Segment — the old
    // rotateBoxYaw90-based placement swapped such a Prop's halfExtents to
    // stay visually correct there, which this no longer does for ANY angle.
    // Every Prop `modules.ts` authors today is a cube (rotation-invariant in
    // shape), so nothing currently observable regresses; flagging so a future
    // oblong Prop author doesn't quietly inherit a mismatched collider.
    for (const prop of module.props ?? []) {
      const shape: PropConfig["shape"] =
        prop.shape.kind === "box"
          ? { kind: "box", halfExtents: scaleVec3(prop.shape.halfExtents, scale) }
          : { kind: "ball", radius: prop.shape.radius * scale };
      props.push({ ...prop, shape, center: placePoint(prop.center) });
    }

    for (const spinner of module.spinners ?? []) {
      // A Spinner always spins around world Y (`Spinner.ts` hardcodes this) —
      // only its position and its yaw-driven `initialAngle` (which way it
      // starts facing) follow the Segment's orientation; pitch/roll don't
      // tilt its spin axis. A known limitation, not attempted here.
      spinners.push({
        ...spinner,
        center: placePoint(spinner.center),
        armLength: spinner.armLength * scale,
        halfHeight: spinner.halfHeight * scale,
        armRadius: spinner.armRadius * scale,
        initialAngle: (spinner.initialAngle ?? 0) + segment.rotation,
      });
    }

    if (module.checkpoint) {
      checkpoints.push({
        respawn: placePoint(module.checkpoint.respawn),
        // Rotated exactly like a static Box (ADR 0034 code review) —
        // `pointInOrientedBox` un-rotates the query point at containment-check
        // time, so this is correct at any angle, not an axis-aligned
        // approximation (the old rotateBoxYaw90-based placement only handled
        // 90°/270° correctly, by swapping halfExtents).
        trigger: placeBox(module.checkpoint.trigger),
      });
    }

    if (module.finishZone) {
      // Placed exactly like a Checkpoint's trigger and nothing else — a
      // Finish Zone is detection-only (ADR 0039), so there is no respawn
      // point to translate alongside it and no direction to rotate.
      finishZones.push({ trigger: placeBox(module.finishZone.trigger) });
    }

    // Gates (ADR 0068): a finish sign always Qualifies; a hoop or an arch is a
    // Checkpoint only when switched on. Openings stay still — publish refuses
    // Motion on either, and a Track that arrives with it anyway gets no gate.
    if (module.gate?.role === "finish" && !hasMotion(segment.motion)) {
      finishZones.push({ gate: placeGate(module.gate.opening, segment.position, orientation, scale) });
    }
    if (segment.checkpoint !== undefined) {
      if (module.gate?.role !== "checkpoint") {
        warnings.push(`Segment ${segmentIndex} is marked Checkpoint ${segment.checkpoint.order}, but "${segment.moduleId}" is not a hoop or an arch — ignored`);
      } else if (hasMotion(segment.motion)) {
        warnings.push(`Segment ${segmentIndex} (Checkpoint ${segment.checkpoint.order}) moves — a Checkpoint gate must stay still, ignored`);
      }
    }

    for (const pad of module.launchPads ?? []) {
      // `velocity` is a direction/magnitude, not a point — rotated by the
      // Segment's own orientation (like a Spinner's `initialAngle`) but
      // never translated (unlike `trigger`/`respawn`, which are positions).
      launchPads.push({ trigger: placeBox(pad.trigger), velocity: rotateVec3ByQuat(pad.velocity, orientation) });
      launchPadOwners.push(segmentIndex);
    }

    if (module.launch) {
      // A Spring (ADR 0069): the trigger scales with the Segment (a bigger
      // Spring is a bigger target), the throw does not — the height is the
      // number the author typed, and `launchVelocityFor` points it up the
      // Module's own +Y, so tilting the Segment aims it.
      const height = launchHeightOf(segment.launch, module.launch);
      launchPads.push({
        trigger: placeBox(module.launch.trigger),
        velocity: rotateVec3ByQuat(launchVelocityFor(height), orientation),
      });
      launchPadOwners.push(segmentIndex);
      if (hasMotion(segment.motion)) {
        warnings.push(
          `segment ${segmentIndex} (${segment.moduleId}): a Spring on a Moving Segment launches from where it rests — its trigger stays at the rest pose`,
        );
      }
    }

    for (const volume of module.volumes ?? []) {
      // `force`, like a launch pad's `velocity`, is a direction/magnitude —
      // rotated, never translated.
      volumes.push({ ...volume, bounds: placeBox(volume.bounds), force: rotateVec3ByQuat(volume.force, orientation) });
    }
  }

  // Gate Checkpoints after any retired block's, by number (ADR 0068). The
  // respawn floor is found now that every still collider is placed.
  for (const entry of gateCheckpointPlans(track, modules)) {
    const ownBoxes = statics.filter((_, i) => staticOwners[i] !== entry.segmentIndex);
    const ownMeshes = staticTrimeshes.filter((_, i) => trimeshOwners[i] !== entry.segmentIndex);
    let floor = entry.respawn;
    for (const probe of entry.probes) floor ??= floorBelow(probe, ownBoxes, ownMeshes);
    if (!floor) {
      warnings.push(`Segment ${entry.segmentIndex} (Checkpoint ${entry.order}) has no floor in front of or behind it — pick a respawn spot; not a Checkpoint until then`);
      continue;
    }
    checkpoints.push({ respawn: { x: floor.x, y: floor.y + RESPAWN_ABOVE_FLOOR, z: floor.z }, gate: entry.gate });
  }

  return {
    statics,
    staticSurfaces,
    staticConveyors,
    staticTrimeshes,
    props,
    spinners,
    checkpoints,
    finishZones,
    launchPads,
    launchPadOwners,
    volumes,
    movingSegments,
    conveyors,
    iceDecks,
    mudDecks,
    bounceDecks,
    warnings,
  };
};
