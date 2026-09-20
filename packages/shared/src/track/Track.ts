import { orientBox, type Box } from "../math/box.js";
import { conjugateQuat, eulerQuat, mulQuat, quatToEuler, yawQuat, type Quat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, scaleVec3, subVec3, type Vec3 } from "../math/vec3.js";
import type { EnvironmentId } from "./Environment.js";
import { findSocket, type Module, type Socket } from "./Module.js";
import type { DeckFrame, SegmentConveyor } from "./Conveyor.js";
import type { SegmentLaunch } from "./Launch.js";
import { hasMotion, type SegmentMotion } from "./Motion.js";
import { isCheckpointGate, respawnProbeOrigins, startSegmentIndex, type SegmentCheckpoint } from "./Course.js";
import { placeGate, type PlacedGate } from "./Gate.js";
import type { SolidShape } from "./asset.js";
import { deckPlanOf } from "./DeckPlan.js";
import type { SegmentColorId } from "./SegmentColor.js";

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
 *
 * Everything else a Segment carries is an Attachment ({@link
 * SegmentAttachments}, ADR 0099). A new field is one or the other: where the
 * Segment stands, here, or what is authored on it, there — where the registry
 * makes every edit, publish and copy keep it.
 */
export interface Segment extends SegmentAttachments {
  moduleId: string;
  position: Vec3;
  rotation: number;
  pitch?: number;
  roll?: number;
  manuallyPlaced?: boolean;
  /**
   * Uniform size (ADR 0062) — additive and optional, 1 when absent. The
   * innermost part of the placement, wrapping the Motion: a rest-local point
   * `p` is at `position + orientation·(scale · motion(p))`, so geometry,
   * Footprint, Sockets, triggers and the Motion's pivots and offsets all grow
   * together.
   */
  scale?: number;
}

/**
 * What is authored on one Segment on top of where it stands (CONTEXT.md:
 * Attachment, ADR 0099). Every field is optional and additive, so every Track
 * stored before one existed reads unchanged. Each is described once in
 * `Attachment.ts`'s `ATTACHMENTS`, which will not compile without it.
 */
export interface SegmentAttachments {
  /**
   * How this Segment moves, if it does (ADR 0061) — additive and optional
   * like `pitch`/`roll`, so every Track stored before it reads unchanged.
   * Applied in the Segment's local frame, before its placement.
   */
  motion?: SegmentMotion;
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
  /**
   * This Segment is a Prop (CONTEXT.md: Prop, ADR 0095) — a dynamic body a
   * Character can shove around, instead of the immovable scenery a placed
   * Asset is by default. Exactly `true` when present, additive and optional
   * like `ice`/`mud`/`bounce`, so every Track stored before it reads unchanged.
   *
   * An Attachment rather than a property of the Asset, because the same cone
   * is furniture on one Track and a football on the next: the base race's ice
   * bumpers and Cog Arena's rim bumpers are balls that must stay exactly where
   * they were put.
   */
  prop?: boolean;
  /**
   * This Segment's paint (one of `SEGMENT_COLORS`, `SegmentColor.ts`) — which hue the
   * colored parts of its Asset wear. Additive and optional: a Segment without
   * one renders its file's own authored look. Purely visual — neither
   * `resolveTrack` nor the Match server reads it — so unlike every other
   * Attachment it also rides on a Prop.
   */
  color?: SegmentColorId;
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
 * The deck a Segment's overlays sit on (ADR 0064/0066/0067): its footprint
 * frame on the top of its own collision, measured in the Module's frame and
 * then placed with the whole Segment — so a pitched or rolled deck's overlay
 * lies in the deck's plane, where a belt visibly runs and an ice/mud sheet
 * lies. (The highest *world* point of a ramp is its top edge, and a flat
 * sheet there floats over the rest of it.) Moving Segments resolve at the
 * rest pose like everything else of theirs; the game client re-parents the
 * overlay under the Segment's own group so it follows the Motion.
 */
export const segmentDeckFrame = (segment: Segment, module: Module, scale: number, orientation: Quat): DeckFrame => {
  let top = 0;
  for (const box of module.statics) top = Math.max(top, box.center.y + box.halfExtents.y);
  for (const mesh of module.asset?.meshes ?? []) {
    for (const p of mesh.positions) top = Math.max(top, p.y);
  }
  const { center, halfExtents } = module.footprint.bounds;
  // The shape inside the rectangle (ADR 0096), when the Asset's own top face
  // is not the rectangle — what stops a round piece wearing a square of ice.
  const plan = deckPlanOf(module, scale);
  return {
    center: addVec3(rotateVec3ByQuat(scaleVec3({ x: center.x, y: top, z: center.z }, scale), orientation), segment.position),
    yaw: segment.rotation,
    orientation,
    halfX: halfExtents.x * scale,
    halfZ: halfExtents.z * scale,
    ...(plan === undefined ? {} : { plan }),
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
/** How far back Discover's TRENDING counts plays (ADR 0110): a week. */
export const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How far back TODAY'S FEATURED CHAOS counts plays (ADR 0110): a day. */
export const FEATURED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TrackListing {
  id: string;
  name: string | null;
  authorId: string;
  createdAt: number;
  /**
   * The latest Revision's number (ADR 0032) — what pins its Thumbnail URL
   * (ADR 0105), so a preloaded picture is cached for good and a republish
   * gets a fresh URL of its own.
   */
  revision: number;
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
  /** Rounds started on this Track in the last {@link TRENDING_WINDOW_MS} — what TRENDING ranks by (ADR 0110). */
  playsThisWeek: number;
  /** Rounds started on this Track in the last {@link FEATURED_WINDOW_MS} — TODAY'S FEATURED CHAOS (ADR 0110). */
  playsToday: number;
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
    const deck = segmentDeckFrame(start, startModule, segmentScale(start), segmentOrientation(start));
    const across = Math.min(SPAWN_SPACING_ACROSS, Math.max(SPAWN_SPACING_MIN, (2 * deck.halfX) / 4));
    const back = Math.min(SPAWN_SPACING_BACK, Math.max(SPAWN_SPACING_MIN, (2 * deck.halfZ) / 3));
    // The grid's cells in slot order, then fallback cells between and beside
    // them (still on the deck) — see the avoidance rule below.
    const cells: { x: number; z: number }[] = [];
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) cells.push({ x: (c - 1.5) * across, z: (r - 1) * back });
    for (const shift of [-0.5, 0.5]) {
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 5; c += 1) {
          const cell = { x: (c - 2) * across, z: (r - 1 + shift) * back };
          if (Math.abs(cell.x) <= deck.halfX - SPAWN_DECK_MARGIN && Math.abs(cell.z) <= deck.halfZ - SPAWN_DECK_MARGIN) cells.push(cell);
        }
      }
    }
    // A slot never sits inside anything standing ON the Start deck — a flag,
    // a rail, whatever an author dressed it with (found live 2026-09-18/19:
    // "spawnul jsem se v assetu"). Everything the Track places is tested by
    // its collision bounds (its footprint when it has none), in the band a
    // standing Character occupies, so decorative cloth counts too. With
    // nothing in the way the twelve slots are exactly the grid above; a
    // blocked cell hands its index to the next free one, deterministically,
    // so every renderer and both simulations seat the same twelve spots.
    const yaw = yawQuat(start.rotation);
    const obstructions = spawnObstructions(track, startIndex!, deck.center.y, modules ?? {});
    const worldOf = (cell: { x: number; z: number }): Vec3 => {
      const turned = rotateVec3ByQuat({ x: cell.x, y: 0, z: cell.z }, yaw);
      return { x: deck.center.x + turned.x, y: deck.center.y + SPAWN_ABOVE_DECK, z: deck.center.z + turned.z };
    };
    const open = obstructions.length === 0 ? cells.slice(0, 12) : cells.filter((cell) => !spawnBlocked(worldOf(cell), obstructions));
    return worldOf(open[slot] ?? cells[slot]!);
  }
  const local: Vec3 = { x: -1.8 + col * 1.2, y: 1.2, z: 0.5 - row * 1.5 };
  const first = start ?? track[0];
  if (!first) return { ...local, z: local.z + 10 };
  // Only the height follows a scaled first piece (ADR 0062): its deck moves up
  // or down with it, but Players stay a Player's width apart at any size.
  const scaled = { ...local, y: local.y * segmentScale(first) };
  return addVec3(first.position, rotateVec3ByQuat(scaled, segmentOrientation(first)));
};

/** Cached asset-local collision AABB per Module (its footprint when it carries no meshes) — the spawn avoidance's read. */
const moduleBoundsCache = new WeakMap<Module, { min: Vec3; max: Vec3 }>();

const moduleCollisionBounds = (module: Module): { min: Vec3; max: Vec3 } => {
  const cached = moduleBoundsCache.get(module);
  if (cached) return cached;
  let bounds: { min: Vec3; max: Vec3 } | undefined;
  for (const mesh of module.asset?.meshes ?? []) {
    for (const v of mesh.positions) {
      if (!bounds) bounds = { min: { ...v }, max: { ...v } };
      else {
        bounds.min = { x: Math.min(bounds.min.x, v.x), y: Math.min(bounds.min.y, v.y), z: Math.min(bounds.min.z, v.z) };
        bounds.max = { x: Math.max(bounds.max.x, v.x), y: Math.max(bounds.max.y, v.y), z: Math.max(bounds.max.z, v.z) };
      }
    }
  }
  if (!bounds) {
    const { center, halfExtents } = module.footprint.bounds;
    bounds = {
      min: { x: center.x - halfExtents.x, y: center.y - halfExtents.y, z: center.z - halfExtents.z },
      max: { x: center.x + halfExtents.x, y: center.y + halfExtents.y, z: center.z + halfExtents.z },
    };
  }
  moduleBoundsCache.set(module, bounds);
  return bounds;
};

/** One thing standing over the Start deck, as a world-space XZ box already inflated by a Character's clearance. */
interface SpawnObstruction {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Everything the Track stands ON the Start deck in the band a spawning
 * Character occupies — from {@link SPAWN_OBSTRUCTION_ABOVE} over the deck top
 * (so a neighbouring floor's own top face never counts) up to standing head
 * height. World-axis AABBs are deliberately conservative: a Character keeps a
 * little extra distance from a turned piece, never too little.
 */
const spawnObstructions = (track: Track, startIndex: number, deckTopY: number, modules: Record<string, Module>): SpawnObstruction[] => {
  const out: SpawnObstruction[] = [];
  track.forEach((segment, i) => {
    if (i === startIndex) return;
    const module = modules[segment.moduleId];
    if (!module) return;
    const { min, max } = moduleCollisionBounds(module);
    const scale = segmentScale(segment);
    const orientation = segmentOrientation(segment);
    let [minX, maxX, minZ, maxZ, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          const world = addVec3(segment.position, rotateVec3ByQuat(scaleVec3({ x, y, z }, scale), orientation));
          [minX, maxX] = [Math.min(minX, world.x), Math.max(maxX, world.x)];
          [minZ, maxZ] = [Math.min(minZ, world.z), Math.max(maxZ, world.z)];
          [minY, maxY] = [Math.min(minY, world.y), Math.max(maxY, world.y)];
        }
      }
    }
    if (maxY < deckTopY + SPAWN_OBSTRUCTION_ABOVE || minY > deckTopY + SPAWN_OBSTRUCTION_HEAD) return;
    out.push({
      minX: minX - SPAWN_CLEARANCE,
      maxX: maxX + SPAWN_CLEARANCE,
      minZ: minZ - SPAWN_CLEARANCE,
      maxZ: maxZ + SPAWN_CLEARANCE,
    });
  });
  return out;
};

const spawnBlocked = (at: Vec3, obstructions: readonly SpawnObstruction[]): boolean =>
  obstructions.some((o) => at.x >= o.minX && at.x <= o.maxX && at.z >= o.minZ && at.z <= o.maxZ);

/** The spawn grid's spacing on a Start (ADR 0068): M1's own, squeezed no tighter than a Player's width. */
const SPAWN_SPACING_ACROSS = 1.2;
const SPAWN_SPACING_BACK = 1.5;
const SPAWN_SPACING_MIN = 0.8;
/** How far a spawn slot keeps from anything standing on the deck: a capsule's radius plus breathing room. */
const SPAWN_CLEARANCE = 0.55;
/** Obstructions start this far over the deck top — a neighbouring floor's own top face never counts, a rail or a flag does. */
const SPAWN_OBSTRUCTION_ABOVE = 0.3;
/** ...and end at standing head height over the deck. */
const SPAWN_OBSTRUCTION_HEAD = 2.2;
/** A fallback cell keeps this far inside the deck's edge. */
const SPAWN_DECK_MARGIN = 0.45;

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
