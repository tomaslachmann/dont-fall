import {
  addVec3,
  attachmentsOf,
  clampLaunchHeight,
  conjugateQuat,
  findSocket,
  inflateBox,
  lengthVec3,
  obbsOverlap,
  orientBox,
  hasSocket,
  MAX_SEGMENT_SCALE,
  MIN_SEGMENT_SCALE,
  placeAfter,
  rotateVec3ByQuat,
  scaleBox,
  scaleVec3,
  segmentOrientation,
  segmentScale,
  subVec3,
  type AssetCategory,
  type Module,
  type AttachmentKey,
  type Quat,
  type Segment,
  type SegmentMotion,
  type Track,
  type Vec3,
  type BombTiming,
  type PunchTiming,
  type ShooterTiming,
  type TrapDoorTiming,
} from "@dont-fall/shared";

/**
 * An absolute Segment position/orientation — what `setSegmentTransform`/
 * `setSegmentTransforms` set wholesale, and what the on-canvas gizmo's
 * drag-end commit produces (ticket 03/05). Canonical home for this shape:
 * `viewport.ts` re-exports it as `SegmentTransform` rather than declaring
 * its own copy (code review, ticket 05), since `trackEdit.ts` can't import
 * from `viewport.ts` (which already imports the other direction, from here).
 */
export interface SegmentTransform {
  position: Vec3;
  rotation: number;
  pitch: number;
  roll: number;
  /** Uniform scale (ADR 0062); omitted means "leave the Segment's scale as it is". */
  scale?: number;
}

/** `segment` with `scale`, and no `scale` key at all when that is 1 — how every stored Segment spells "unscaled". */
const withScale = (segment: Segment, scale: number | undefined): Segment => {
  const { scale: _previous, ...rest } = segment;
  return scale === undefined || scale === 1 ? rest : { ...rest, scale };
};

/** A world Socket position on `segment` — its local position scaled, rotated and placed (ADR 0062). */
const socketWorld = (segment: Segment, localPosition: Vec3): Vec3 =>
  addVec3(segment.position, rotateVec3ByQuat(scaleVec3(localPosition, segmentScale(segment)), segmentOrientation(segment)));

const assertIndexInRange = (fn: string, track: Track, index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= track.length) {
    throw new Error(`${fn}: index ${index} is out of range for a Track of length ${track.length}`);
  }
};

/** Same bound as {@link assertIndexInRange} but allows `index === track.length` (an append/insert-at-end). */
const assertInsertIndexInRange = (fn: string, track: Track, index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index > track.length) {
    throw new Error(`${fn}: index ${index} is out of range for a Track of length ${track.length}`);
  }
};

/**
 * Whether `module` can be Socket-chained onto `prevModule` — the one rule
 * every chaining path here shares. Not every Module has Sockets (ADR 0034
 * free placement: every converted asset), and
 * `placeAfter`/`findSocket` throw for a missing one, so a pair failing this
 * keeps whatever position it already has, exactly like one the author placed
 * by hand.
 */
const chainsAfter = (prevModule: Module, module: Module): boolean =>
  hasSocket(prevModule, "exit") && hasSocket(module, "entry");

/**
 * `segment` chained onto its predecessor — `placeAfter` builds a fresh
 * Segment, so every Attachment it carries (ADR 0099) is carried over from the
 * one it re-places, or re-chaining after any upstream edit would silently
 * strip it.
 */
const chainOnto = (prevSegment: Segment, prevModule: Module, segment: Segment, module: Module): Segment => ({
  ...placeAfter(prevSegment, prevModule, segment.moduleId, module, "exit", "entry", segmentScale(segment)),
  ...attachmentsOf(segment),
});

/**
 * Re-derives every Segment from `fromIndex` onward via `placeAfter`, chained
 * from whatever sits at `fromIndex - 1` — the single operation every edit
 * (delete/insert/duplicate/rotate/move) reduces to (ticket 08). `fromIndex`'s
 * own `moduleId` is kept; its position/rotation/pitch/roll are recomputed
 * unless it's index 0 (no predecessor to chain from) or it's flagged
 * `manuallyPlaced` (ticket 02) — either way it keeps its own values as-is,
 * and whatever comes after it still chains from wherever it actually is.
 */
export const rechainFrom = (track: Track, modules: Record<string, Module>, fromIndex: number): Track => {
  const result: Track = track.slice(0, fromIndex);
  for (let i = fromIndex; i < track.length; i += 1) {
    const segment = track[i]!;
    const moduleId = segment.moduleId;
    const module = modules[moduleId];
    if (!module) throw new Error(`rechainFrom: unknown Module "${moduleId}"`);

    const prevSegment = i === 0 ? undefined : result[i - 1]!;
    const prevModule = prevSegment ? modules[prevSegment.moduleId] : undefined;
    if (prevSegment && !prevModule) throw new Error(`rechainFrom: unknown Module "${prevSegment.moduleId}"`);

    // `placeAfter` would otherwise throw straight out of a palette click,
    // taking the builder down for a Module the palette openly offers.
    const chainable = prevSegment !== undefined && prevModule !== undefined && chainsAfter(prevModule, module);

    if (!chainable || segment.manuallyPlaced) {
      result.push({ ...segment });
    } else {
      result.push(chainOnto(prevSegment!, prevModule!, segment, module));
    }
  }
  return result;
};

/**
 * Settles just Segment `index` — the one entry `rechainFrom(track, modules,
 * index)` computes that `moveSegment`/`rotateSegment`/`setSegmentTransform`
 * actually need before overwriting it, without also computing (and
 * immediately discarding) every entry after it, which `rechainFrom` would
 * otherwise do in the same pass (code review, ticket 03: those three
 * functions were calling `rechainFrom` twice per edit — once here, then
 * again after the mutation — recomputing the same downstream tail both
 * times for no reason, since the first pass's tail is invalidated by the
 * mutation before it's ever used). Same "trust the prefix" assumption
 * `rechainFrom` itself already makes: `track[index - 1]` is taken as
 * correct as-is, not re-settled recursively.
 */
const settleOne = (fn: string, track: Track, modules: Record<string, Module>, index: number): Segment => {
  const segment = track[index]!;
  const module = modules[segment.moduleId];
  if (!module) throw new Error(`${fn}: unknown Module "${segment.moduleId}"`);
  if (index === 0 || segment.manuallyPlaced) return { ...segment };

  const prevSegment = track[index - 1]!;
  const prevModule = modules[prevSegment.moduleId];
  if (!prevModule) throw new Error(`${fn}: unknown Module "${prevSegment.moduleId}"`);
  // Same rule as `rechainFrom` — skipping it here threw out of every gizmo
  // drag, nudge and rotate of a socketless Segment, so the move showed on
  // screen but never reached the Track, and the next rebuild undid it.
  if (!chainsAfter(prevModule, module)) return { ...segment };
  return chainOnto(prevSegment, prevModule, segment, module);
};

/**
 * Where a newly inserted Segment starts out, before {@link rechainFrom} gets a
 * say. For anything chainable this is thrown away immediately, so it matters
 * only for a Module that cannot be chained (ADR 0034 free placement — every
 * converted asset): that one keeps this position.
 *
 * With the Asset categories to tell a Floor from the rest (user decision,
 * 2026-09-16, re-cut onto one axis by ADR 0122), it builds on the last Floor
 * at or before the insert point: a new Floor continues the run flush off that
 * Floor's far (−Z) face, in whatever direction the Floor is turned, its top
 * level with the Floor's; anything else (Structure, Sweeper, Launcher, Gate,
 * Prop, Scenery) stands on the middle of that Floor's top, turned the same
 * way — a pillar included, which is the user's call (2026-09-21): free
 * placement moves it under the deck in one drag. Both read footprints, the
 * same boxes overlap and Socket-snap use, and the Floor's yaw only: a pitched
 * or rolled Floor places as if it were level.
 *
 * With no Floor to build on (or no categories), it falls back to clear of
 * the Segment it follows, along +X, by both footprints plus the predecessor's
 * clearance — somewhere visible rather than on top of what is already there.
 */
const placementFor = (
  track: Track,
  modules: Record<string, Module>,
  categories: Readonly<Record<string, AssetCategory>>,
  index: number,
  moduleId: string,
): Pick<Segment, "position" | "rotation"> => {
  const inserted = modules[moduleId];
  const category = categories[moduleId];
  let platformIndex = index - 1;
  while (platformIndex >= 0 && categories[track[platformIndex]!.moduleId] !== "floor") platformIndex -= 1;
  const platform = platformIndex >= 0 ? track[platformIndex] : undefined;
  const platformModule = platform ? modules[platform.moduleId] : undefined;

  if (inserted && category && platform && platformModule) {
    const scale = segmentScale(platform);
    const below = platformModule.footprint.bounds;
    const own = inserted.footprint.bounds;
    const top = (below.center.y + below.halfExtents.y) * scale;
    // In the platform's own turned frame, then turned into the world by its yaw.
    const local: Vec3 =
      category === "floor"
        ? {
            x: below.center.x * scale - own.center.x,
            y: top - (own.center.y + own.halfExtents.y),
            z: (below.center.z - below.halfExtents.z) * scale - (own.center.z + own.halfExtents.z),
          }
        : {
            x: below.center.x * scale - own.center.x,
            y: top - (own.center.y - own.halfExtents.y),
            z: below.center.z * scale - own.center.z,
          };
    const turn = segmentOrientation({ rotation: platform.rotation });
    return { position: addVec3(platform.position, rotateVec3ByQuat(local, turn)), rotation: platform.rotation };
  }

  const previous = track[index - 1];
  const previousModule = previous ? modules[previous.moduleId] : undefined;
  if (!previous || !previousModule || !inserted) return { position: { x: 0, y: 0, z: 0 }, rotation: 0 };
  return {
    position: {
      x:
        previous.position.x +
        previousModule.footprint.bounds.halfExtents.x * segmentScale(previous) +
        inserted.footprint.bounds.halfExtents.x +
        previousModule.footprint.clearance,
      y: previous.position.y,
      z: previous.position.z,
    },
    rotation: 0,
  };
};

/**
 * Inserts `moduleId` at `index` (pushing anything already there later) and
 * re-chains from it onward. `categories` (each Asset Module's category) lets
 * an unchainable piece build on the last Floor — see {@link placementFor}.
 */
export const insertSegment = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  moduleId: string,
  categories: Readonly<Record<string, AssetCategory>> = {},
): Track => {
  assertInsertIndexInRange("insertSegment", track, index);
  const placeholder: Segment = { moduleId, ...placementFor(track, modules, categories, index, moduleId) };
  const withPlaceholder = [...track.slice(0, index), placeholder, ...track.slice(index)];
  return rechainFrom(withPlaceholder, modules, index);
};

/** Appends `moduleId` at the end — the common case of {@link insertSegment}. */
export const appendModule = (
  track: Track,
  moduleId: string,
  modules: Record<string, Module>,
  categories: Readonly<Record<string, AssetCategory>> = {},
): Track => insertSegment(track, modules, track.length, moduleId, categories);

/** Removes the Segment at `index` (any index, not just the last) and re-chains everything after it. */
export const deleteSegment = (track: Track, modules: Record<string, Module>, index: number): Track => {
  assertIndexInRange("deleteSegment", track, index);
  const without = track.filter((_, i) => i !== index);
  // Deleting Checkpoint 2 of 3 leaves 1 and 2, never a gap (ADR 0068).
  return compactCheckpoints(rechainFrom(without, modules, Math.min(index, without.length)));
};

/** Removes the most recently placed Segment. A no-op on an empty Track. */
export const removeLast = (track: Track): Track => track.slice(0, -1);

/**
 * Duplicates the Segment at `index`, inserting the copy — every Attachment
 * included (ADR 0099) — right after it. A Track has one Start, so the copy is
 * never it; a Checkpoint's copy is the next Checkpoint (ADR 0068).
 */
export const duplicateSegment = (track: Track, modules: Record<string, Module>, index: number): Track => {
  assertIndexInRange("duplicateSegment", track, index);
  const source = track[index]!;
  const { start: _start, checkpoint, ...copied } = attachmentsOf(source);
  let duplicated = insertSegment(track, modules, index + 1, source.moduleId);
  if (source.scale !== undefined) duplicated = setSegmentScale(duplicated, modules, index + 1, source.scale);
  duplicated = duplicated.map((segment, i) => (i === index + 1 ? { ...segment, ...copied } : segment));
  if (checkpoint) {
    duplicated = setSegmentCheckpoint(duplicated, index + 1, true);
    if (checkpoint.respawn) duplicated = setCheckpointRespawn(duplicated, index + 1, checkpoint.respawn);
  }
  return duplicated;
};

/**
 * Makes the Segment at `index` the Track's Start (`true`) — moving it from
 * wherever it was, a Track has one — or takes it away (ADR 0068).
 */
export const setSegmentStart = (track: Track, index: number, start: boolean): Track => {
  assertIndexInRange("setSegmentStart", track, index);
  return track.map((segment, i) => {
    if (i !== index && !(start && segment.start)) return segment;
    const { start: _previous, ...rest } = segment;
    return start && i === index ? { ...rest, start: true } : rest;
  });
};

/** The number a newly switched-on Checkpoint takes: one past the highest. */
export const nextCheckpointOrder = (track: Track): number =>
  track.reduce((highest, segment) => Math.max(highest, segment.checkpoint?.order ?? 0), 0) + 1;

/**
 * Renumbers every Checkpoint 1, 2, 3… keeping their order — what deleting or
 * switching one off leaves behind, so the numbers an author sees never skip.
 */
export const compactCheckpoints = (track: Track): Track => {
  const ranked = track
    .flatMap((segment, index) => (segment.checkpoint ? [{ index, order: segment.checkpoint.order }] : []))
    .sort((a, b) => a.order - b.order || a.index - b.index);
  const orderOf = new Map(ranked.map((entry, rank) => [entry.index, rank + 1]));
  if (ranked.every((entry, rank) => entry.order === rank + 1)) return track;
  return track.map((segment, index) =>
    segment.checkpoint ? { ...segment, checkpoint: { ...segment.checkpoint, order: orderOf.get(index)! } } : segment,
  );
};

/**
 * Switches the Segment at `index` on as the next Checkpoint, or off (the rest
 * renumbered) — ADR 0068. Whether its Module is a hoop or an arch is the
 * caller's check; publish refuses it otherwise.
 */
export const setSegmentCheckpoint = (track: Track, index: number, on: boolean): Track => {
  assertIndexInRange("setSegmentCheckpoint", track, index);
  if (on) {
    if (track[index]!.checkpoint) return track;
    const order = nextCheckpointOrder(track);
    return track.map((segment, i) => (i === index ? { ...segment, checkpoint: { order } } : segment));
  }
  return compactCheckpoints(
    track.map((segment, i) => {
      if (i !== index) return segment;
      const { checkpoint: _previous, ...rest } = segment;
      return rest;
    }),
  );
};

/** Moves the Checkpoint at `index` one number earlier (−1) or later (+1), swapping with the one there. */
export const stepCheckpointOrder = (track: Track, index: number, direction: 1 | -1): Track => {
  assertIndexInRange("stepCheckpointOrder", track, index);
  const own = track[index]!.checkpoint;
  if (!own) return track;
  const target = own.order + direction;
  const other = track.findIndex((segment) => segment.checkpoint?.order === target);
  if (other === -1) return track;
  return track.map((segment, i) => {
    if (i === index) return { ...segment, checkpoint: { ...segment.checkpoint!, order: target } };
    if (i === other) return { ...segment, checkpoint: { ...segment.checkpoint!, order: own.order } };
    return segment;
  });
};

/**
 * Where a Checkpoint's Respawn stands — a floor spot in the gate's own frame —
 * or back to the floor under the gate (`undefined`). A no-op off a Checkpoint.
 */
export const setCheckpointRespawn = (track: Track, index: number, respawn: Vec3 | undefined): Track => {
  assertIndexInRange("setCheckpointRespawn", track, index);
  return track.map((segment, i) => {
    if (i !== index || !segment.checkpoint) return segment;
    const { respawn: _previous, ...checkpoint } = segment.checkpoint;
    return { ...segment, checkpoint: respawn ? { ...checkpoint, respawn } : checkpoint };
  });
};

/** A world point in `segment`'s own frame — the inverse of its placement, scale included. */
export const worldToSegmentLocal = (segment: Segment, point: Vec3): Vec3 =>
  scaleVec3(rotateVec3ByQuat(subVec3(point, segment.position), conjugateQuat(segmentOrientation(segment))), 1 / segmentScale(segment));

/**
 * Scales the Segment at `index` uniformly (ADR 0062), clamped to the stored
 * bounds. A chained Segment stays attached at its entry — re-placed through
 * its scaled entry Socket — and everything after it re-chains onto the scaled
 * exit; a free-placed one grows about its own origin, where it stands.
 */
export const setSegmentScale = (track: Track, modules: Record<string, Module>, index: number, scale: number): Track => {
  assertIndexInRange("setSegmentScale", track, index);
  const clamped = Math.min(MAX_SEGMENT_SCALE, Math.max(MIN_SEGMENT_SCALE, scale));
  const withScaled = track.map((segment, i) => (i === index ? withScale(segment, clamped) : segment));
  return rechainFrom(withScaled, modules, index);
};

/**
 * Attaches `value` as the Segment at `index`'s `key` Attachment, or detaches
 * it (`undefined`) — ADR 0099. A pure per-Segment swap with no re-chain: an
 * Attachment moves nobody's geometry, not even a Motion, which moves a Segment
 * around where it sits and never where the next one attaches. The Start and a
 * Checkpoint are not here: each is a rule across the Track (one Start;
 * Checkpoints numbered 1, 2, 3…), with a setter of its own above.
 */
export const setSegmentAttachment = <K extends Exclude<AttachmentKey, "start" | "checkpoint">>(
  track: Track,
  index: number,
  key: K,
  value: Segment[K] | undefined,
): Track => {
  assertIndexInRange("setSegmentAttachment", track, index);
  return track.map((segment, i) => {
    if (i !== index) return segment;
    const next: Segment = { ...segment };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });
};

/**
 * Set (`motion`) or clear (`undefined`) the Motion of one Part of a parted
 * Asset (ADR 0124), leaving its other Parts' alone — and the whole
 * `partMotions` Attachment gone once no Part has one of its own.
 */
export const setSegmentPartMotion = (track: Track, index: number, part: string, motion: SegmentMotion | undefined): Track => {
  assertIndexInRange("setSegmentPartMotion", track, index);
  const next = { ...track[index]!.partMotions };
  if (motion === undefined) delete next[part];
  else next[part] = motion;
  return setSegmentAttachment(track, index, "partMotions", Object.keys(next).length > 0 ? next : undefined);
};

/**
 * Set (`height`) or clear (`undefined`) one Spring Segment's own throw
 * height (ADR 0069), pulled into the storable range. Clearing it does not
 * stop the Spring launching; it falls back to the Asset's own default.
 */
export const setSegmentLaunch = (track: Track, index: number, height: number | undefined): Track =>
  setSegmentAttachment(track, index, "launch", height === undefined ? undefined : { height: clampLaunchHeight(height) });

/** What a placed Shooter fires (ADR 0119), or `undefined` to hand it back to its Asset's own numbers. */
export const setSegmentShooter = (track: Track, index: number, timing: ShooterTiming | undefined): Track =>
  setSegmentAttachment(
    track,
    index,
    "shooter",
    timing === undefined
      ? undefined
      : {
          // Balls are what a Shooter fires unless told otherwise, so only bombs are written (ADR 0127).
          ...(timing.ammo === "bomb" ? { ammo: "bomb" as const } : {}),
          ...(timing.periodSeconds === undefined ? {} : { periodSeconds: Math.max(0.1, Math.round(timing.periodSeconds * 10) / 10) }),
          ...(timing.speed === undefined ? {} : { speed: Math.max(0.1, Math.round(timing.speed * 10) / 10) }),
          ...(timing.lifeSeconds === undefined ? {} : { lifeSeconds: Math.max(0.1, Math.round(timing.lifeSeconds * 10) / 10) }),
          ...(timing.yawDegrees === undefined ? {} : { yawDegrees: Math.min(180, Math.max(0, Math.round(timing.yawDegrees))) }),
          ...(timing.yawSeconds === undefined ? {} : { yawSeconds: Math.max(0.1, Math.round(timing.yawSeconds * 10) / 10) }),
          ...(timing.pitchDegrees === undefined ? {} : { pitchDegrees: Math.min(180, Math.max(0, Math.round(timing.pitchDegrees))) }),
          ...(timing.pitchSeconds === undefined ? {} : { pitchSeconds: Math.max(0.1, Math.round(timing.pitchSeconds * 10) / 10) }),
        },
  );

/** How long a placed fragile floor stays gone (ADR 0118), or `undefined` to hand it back to its Asset's own delay. */
export const setSegmentFragile = (track: Track, index: number, returnSeconds: number | undefined): Track =>
  setSegmentAttachment(
    track,
    index,
    "fragile",
    returnSeconds === undefined ? undefined : { returnSeconds: Math.max(0, Math.round(returnSeconds * 10) / 10) },
  );

/**
 * A placed bomb's fuse and return (ADR 0126), or `undefined` to hand it back
 * to its Asset's own clock. Tenths of a second, and never under
 * {@link BOMB_SECONDS_MIN}: a bomb that goes off as it is picked up is a trap
 * nobody could have seen.
 */
export const setSegmentBomb = (track: Track, index: number, timing: BombTiming | undefined): Track =>
  setSegmentAttachment(
    track,
    index,
    "bomb",
    timing === undefined
      ? undefined
      : {
          ...(timing.fuseSeconds === undefined ? {} : { fuseSeconds: Math.max(BOMB_SECONDS_MIN, Math.round(timing.fuseSeconds * 10) / 10) }),
          ...(timing.returnSeconds === undefined ? {} : { returnSeconds: Math.max(BOMB_SECONDS_MIN, Math.round(timing.returnSeconds * 10) / 10) }),
        },
  );

/**
 * How often a placed trap door runs (ADR 0117), or `undefined` to hand it
 * back to its Asset's own clock. The period is floored at the authored swing
 * — a shorter one would cut a leaf off mid-fall, which publish refuses
 * anyway; the panel simply never offers it.
 */
export const setSegmentTrapDoor = (track: Track, index: number, timing: TrapDoorTiming | undefined, swingSeconds: number): Track => {
  if (timing === undefined) return setSegmentAttachment(track, index, "trapdoor", undefined);
  const period = timing.period === undefined ? undefined : Math.max(swingSeconds, Math.round(timing.period * 10) / 10);
  const phase = timing.phase === undefined || timing.phase === 0 ? undefined : timing.phase;
  return setSegmentAttachment(track, index, "trapdoor", {
    ...(period === undefined ? {} : { period }),
    ...(phase === undefined ? {} : { phase }),
  });
};

// Two-tier snap steps (ADR 0034). `MOVE_STEP_FINE`/`ROTATE_STEP`/
// `ROTATE_STEP_FINE` are shared by the keyboard nudge (ticket 02) and the
// on-canvas gizmo (ticket 03), so the two interaction paths can never
// silently drift apart on what "coarse"/"fine" mean. `MOVE_STEP` (the
// keyboard's *coarse* position step) is also the gizmo's default grid, under
// Socket- and face-snap (`snapDragPosition`) — one grid for both input paths.
export const MOVE_STEP = 0.5;
export const MOVE_STEP_FINE = 0.1;
export const ROTATE_STEP = (15 * Math.PI) / 180;
export const ROTATE_STEP_FINE = (5 * Math.PI) / 180;
/** Scale steps (ADR 0062): the Scale gizmo and the −/+ keys and buttons snap to these; Shift is the finer one. */
export const SCALE_STEP = 0.25;
export const SCALE_STEP_FINE = 0.05;

/** A Spring's height steps in whole metres, or tenths on Shift (ADR 0069) — the stepper's two tiers, like every other number here. */
export const LAUNCH_HEIGHT_STEP = 1;
export const LAUNCH_HEIGHT_STEP_FINE = 0.1;

/** How often a placed punching glove swings (ADR 0121), or `undefined` to hand it back to its Asset's own clock. */
export const setSegmentPunch = (track: Track, index: number, timing: PunchTiming | undefined): Track =>
  setSegmentAttachment(
    track,
    index,
    "punch",
    timing === undefined
      ? undefined
      : {
          ...(timing.period === undefined ? {} : { period: Math.max(0.1, Math.round(timing.period * 10) / 10) }),
          ...(timing.phase === undefined || timing.phase === 0 ? {} : { phase: timing.phase }),
          ...(timing.rate === undefined ? {} : { rate: Math.max(0.1, Math.round(timing.rate * 10) / 10) }),
        },
  );

/** A Shooter's numbers step by one, or a tenth on Shift (ADR 0119) — seconds for two of them, units per second for the third. */
export const SHOOTER_STEP = 1;
export const SHOOTER_STEP_FINE = 0.1;

/** A bomb's fuse and return step in whole seconds, or tenths on Shift, and go no lower than half a second (ADR 0126). */
export const BOMB_STEP = 1;
export const BOMB_STEP_FINE = 0.1;
export const BOMB_SECONDS_MIN = 0.5;

/** A fragile floor's return delay steps in whole seconds, or tenths on Shift (ADR 0118). */
export const FRAGILE_RETURN_STEP = 1;
export const FRAGILE_RETURN_STEP_FINE = 0.1;

/** A trap door's period steps in whole seconds, or tenths on Shift (ADR 0117) — the same two tiers. */
export const TRAPDOOR_PERIOD_STEP = 1;
export const TRAPDOOR_PERIOD_STEP_FINE = 0.1;
/** Its phase steps by a quarter of a cycle, the four the panel offers. */
export const TRAPDOOR_PHASE_STEP = 0.25;

/** `scale` snapped to `step` and held inside the stored bounds — every scale input's last word. */
export const snapScale = (scale: number, step: number): number =>
  Math.min(MAX_SEGMENT_SCALE, Math.max(MIN_SEGMENT_SCALE, Math.round(scale / step) * step));

const TWO_PI = Math.PI * 2;
const normalizeAngle = (radians: number): number => ((radians % TWO_PI) + TWO_PI) % TWO_PI;

/** Which of a Segment's three orientation fields a rotate step turns (ADR 0034/ticket 02). */
export type RotateAxis = "yaw" | "pitch" | "roll";

const FIELD_BY_AXIS: Record<RotateAxis, "rotation" | "pitch" | "roll"> = {
  yaw: "rotation",
  pitch: "pitch",
  roll: "roll",
};

/**
 * Rotates the Segment at `index` by `deltaRadians` on `axis` (defaults to
 * `"yaw"`, matching every existing caller — the toolbar's ±90° buttons)
 * around its own entry Socket — the world point where it connects to
 * whatever's before it stays fixed, only its facing (and, since it pivots
 * around an off-centre Socket, its own position) changes. Everything after
 * `index` is then re-chained naturally from the newly-rotated Segment.
 * Marks the Segment `manuallyPlaced` (ticket 02) — an explicit rotation
 * exempts it from a later unrelated edit silently resetting it.
 *
 * No longer restricted to a multiple of 90° (ADR 0034 lifted ADR 0031's
 * restriction at the data-model/physics level) — the toolbar's two buttons
 * still only ever call this with exactly ±90° on the yaw axis; `axis` and
 * finer deltas exist for ticket 02's keyboard nudge / ticket 03's gizmo.
 *
 * Simplification: rotating Segment `index` does not try to preserve any
 * rotation a later Segment already had independently — re-chaining always
 * continues "straight" (0 additional twist) from `index` onward. Every
 * current Module is a straight corridor anyway (no authored turn variant
 * exists yet), so there is nothing downstream to preserve in practice; this
 * is a deliberate v1 boundary, not an oversight (ticket 08).
 */
export const rotateSegment = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  deltaRadians: number,
  axis: RotateAxis = "yaw",
): Track => {
  assertIndexInRange("rotateSegment", track, index);
  // Defensive, not redundant: `track` isn't guaranteed already-settled — it
  // may have come from `history.reset` (a Track loaded from the API,
  // possibly saved by a different, less careful caller than this module's
  // own edit functions).
  const segment = settleOne("rotateSegment", track, modules, index);
  const module = modules[segment.moduleId]!; // settleOne already validated this exists

  const field = FIELD_BY_AXIS[axis];
  const newValue = normalizeAngle((segment[field] ?? 0) + deltaRadians);
  const withNewAngle: Segment = { ...segment, [field]: newValue, manuallyPlaced: true };

  // Pivots on the entry Socket only where one joins this Segment to its
  // predecessor; anything unchained turns in place about its own origin —
  // for an asset, the pivot its file is seated on.
  const prevModule = index === 0 ? undefined : modules[track[index - 1]!.moduleId];
  let rotated: Segment;
  if (!prevModule || !chainsAfter(prevModule, module)) {
    rotated = withNewAngle;
  } else {
    const entry = scaleVec3(findSocket(module, "entry").position, segmentScale(segment));
    const anchor = addVec3(segment.position, rotateVec3ByQuat(entry, segmentOrientation(segment)));
    const newPosition = subVec3(anchor, rotateVec3ByQuat(entry, segmentOrientation(withNewAngle)));
    rotated = { ...withNewAngle, position: newPosition };
  }

  // `track.slice(index + 1)` is a placeholder only — `rechainFrom` below
  // recomputes every one of those entries from `rotated` onward regardless.
  const withRotated = [...track.slice(0, index), rotated, ...track.slice(index + 1)];
  return rechainFrom(withRotated, modules, index + 1);
};

/**
 * Moves the Segment at `index` by `delta` (world-space, ticket 02's keyboard
 * nudge) — unlike `rotateSegment`, there's no Socket to keep anchored; the
 * Segment's position is simply offset. Marks it `manuallyPlaced`, then
 * re-chains everything after it from the new position, exactly like every
 * other edit in this module.
 */
export const moveSegment = (track: Track, modules: Record<string, Module>, index: number, delta: Vec3): Track => {
  assertIndexInRange("moveSegment", track, index);
  const segment = settleOne("moveSegment", track, modules, index);
  const moved: Segment = { ...segment, position: addVec3(segment.position, delta), manuallyPlaced: true };

  // `track.slice(index + 1)` is a placeholder only — see `rotateSegment`.
  const withMoved = [...track.slice(0, index), moved, ...track.slice(index + 1)];
  return rechainFrom(withMoved, modules, index + 1);
};

/**
 * Sets the Segment at `index`'s position/orientation to an absolute value —
 * the on-canvas gizmo's drag-end commit (ticket 03), unlike `moveSegment`/
 * `rotateSegment`'s deltas. Marks it `manuallyPlaced`, then re-chains
 * everything after it, exactly like every other edit in this module.
 */
export const setSegmentTransform = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  transform: SegmentTransform,
): Track => {
  assertIndexInRange("setSegmentTransform", track, index);
  const segment = settleOne("setSegmentTransform", track, modules, index);
  const { scale, ...placement } = transform;
  const updated: Segment = withScale({ ...segment, ...placement, manuallyPlaced: true }, scale ?? segment.scale);

  // `track.slice(index + 1)` is a placeholder only — see `rotateSegment`.
  const withUpdated = [...track.slice(0, index), updated, ...track.slice(index + 1)];
  return rechainFrom(withUpdated, modules, index + 1);
};

/**
 * Batched form of {@link setSegmentTransform} — the multi-select gizmo's
 * rigid-group drag-end commit (ticket 05): every Segment named in `updates`
 * gets its own absolute transform and `manuallyPlaced` flag, exactly as a
 * single-Segment drag would. Implemented as a straight fold over the
 * single-Segment function rather than a new algorithm — each update already
 * carries its own final absolute transform (computed live by the caller from
 * the dragged pivot's offset), so there's nothing about "doing several at
 * once" that isn't just "do each one, in turn."
 */
export const setSegmentTransforms = (
  track: Track,
  modules: Record<string, Module>,
  updates: { index: number; transform: SegmentTransform }[],
): Track => updates.reduce((acc, { index, transform }) => setSegmentTransform(acc, modules, index, transform), track);

/** Snap radius (world units) for Socket-snapping a translate drag (ticket 03). */
export const SOCKET_SNAP_RADIUS = 1.5;

/**
 * If the Segment at `index`, placed at `candidatePosition` (its rotation
 * unchanged — Socket-snap and rotate-snap are independent concerns, per the
 * ticket), would land its own entry or exit Socket within
 * {@link SOCKET_SNAP_RADIUS} of the matching Socket on its immediate
 * neighbor in the sequence — the predecessor's exit, or the successor's
 * entry — returns `candidatePosition` adjusted so that Socket lands exactly
 * on the neighbor's. Otherwise returns `candidatePosition` unchanged.
 *
 * Deliberately scoped to the Track's own two natural connection points
 * (immediate predecessor/successor), not a track-wide nearest-Socket search
 * across every Segment — Track topology is still a single linear,
 * non-branching sequence (ADR 0030, unchanged by ADR 0034), so "the nearest
 * compatible Socket" for a Segment in that sequence means reconnecting to
 * whichever neighbor it already has, not grabbing onto an arbitrary distant
 * Segment's Socket.
 */
export const snapPositionToNeighborSocket = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  candidatePosition: Vec3,
): Vec3 => {
  const segment = track[index];
  const module = segment && modules[segment.moduleId];
  if (!segment || !module) return candidatePosition;
  const orientation = segmentOrientation(segment);

  const neighbors: { localSocketId: string; targetWorld: Vec3 }[] = [];
  // Only Socket pairs that exist can snap; a socketless Segment or neighbor
  // simply has nothing to snap to (and `findSocket` would throw mid-drag).
  const prev = track[index - 1];
  const prevModule = prev && modules[prev.moduleId];
  if (prev && prevModule && chainsAfter(prevModule, module)) {
    neighbors.push({ localSocketId: "entry", targetWorld: socketWorld(prev, findSocket(prevModule, "exit").position) });
  }
  const next = track[index + 1];
  const nextModule = next && modules[next.moduleId];
  if (next && nextModule && chainsAfter(module, nextModule)) {
    neighbors.push({ localSocketId: "exit", targetWorld: socketWorld(next, findSocket(nextModule, "entry").position) });
  }

  let best: { position: Vec3; distance: number } | undefined;
  for (const neighbor of neighbors) {
    const localSocket = scaleVec3(findSocket(module, neighbor.localSocketId).position, segmentScale(segment));
    const candidateSocket = addVec3(candidatePosition, rotateVec3ByQuat(localSocket, orientation));
    const offset = subVec3(neighbor.targetWorld, candidateSocket);
    const distance = lengthVec3(offset);
    if (distance <= SOCKET_SNAP_RADIUS && (!best || distance < best.distance)) {
      best = { position: addVec3(candidatePosition, offset), distance };
    }
  }
  return best?.position ?? candidatePosition;
};

/** How close (world units) a dragged Segment's Footprint face must come to another's before it lands flush against it. */
export const FACE_SNAP_RADIUS = 0.5;

type Axis = "x" | "y" | "z";
const AXES: Axis[] = ["x", "y", "z"];

/** World-axis-aligned bounds of a Footprint placed at `position`/`orientation` — exact for right-angle turns, conservative otherwise. */
const worldFootprintBounds = (module: Module, position: Vec3, orientation: Quat, scale: number): { min: Vec3; max: Vec3 } => {
  const { center, halfExtents: h } = orientBox(scaleBox(module.footprint.bounds, scale), position, orientation);
  const ex = rotateVec3ByQuat({ x: h.x, y: 0, z: 0 }, orientation);
  const ey = rotateVec3ByQuat({ x: 0, y: h.y, z: 0 }, orientation);
  const ez = rotateVec3ByQuat({ x: 0, y: 0, z: h.z }, orientation);
  const half = {
    x: Math.abs(ex.x) + Math.abs(ey.x) + Math.abs(ez.x),
    y: Math.abs(ex.y) + Math.abs(ey.y) + Math.abs(ez.y),
    z: Math.abs(ex.z) + Math.abs(ey.z) + Math.abs(ez.z),
  };
  return { min: subVec3(center, half), max: addVec3(center, half) };
};

/**
 * Where a gizmo translate drag puts the Segment at `index` (the default tier;
 * Shift's fine grid bypasses this). Only the axes the drag moves (`axes`) are
 * touched, so dragging one arrow never shifts the Segment along another. In
 * order:
 *
 * 1. Socket-snap to a chain neighbor, when one is in range — unchanged.
 * 2. Per axis, face snap: if the dragged Footprint's face comes within
 *    {@link FACE_SNAP_RADIUS} of an opposing face of any other Segment's
 *    Footprint that it overlaps across the other two axes, it lands flush —
 *    base onto a top face (stacking), top under a bottom, side against side.
 *    Every converted asset is socketless, so this is the only snapping most
 *    of a Track gets. Bounds, not clearance: flush means touching.
 * 3. Any axis still free lands on the {@link MOVE_STEP} grid — the keyboard's
 *    coarse step, so both input paths share one grid. Assets sit on their
 *    pivot (resting on y = 0), so a grid height is a grid base.
 */
export const snapDragPosition = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  candidatePosition: Vec3,
  axes: Record<Axis, boolean>,
): Vec3 => {
  const socketSnapped = snapPositionToNeighborSocket(track, modules, index, candidatePosition);
  if (socketSnapped !== candidatePosition) return socketSnapped;
  const segment = track[index];
  const module = segment && modules[segment.moduleId];
  if (!segment || !module) return candidatePosition;

  const moved = worldFootprintBounds(module, candidatePosition, segmentOrientation(segment), segmentScale(segment));
  const others = track.flatMap((other, otherIndex) => {
    const otherModule = modules[other.moduleId];
    return otherIndex === index || !otherModule
      ? []
      : [worldFootprintBounds(otherModule, other.position, segmentOrientation(other), segmentScale(other))];
  });

  const snapped = { ...candidatePosition };
  for (const axis of AXES) {
    if (!axes[axis]) continue;
    const [u, v] = AXES.filter((a) => a !== axis) as [Axis, Axis];
    let best: number | undefined;
    for (const other of others) {
      // Faces only meet where the boxes overlap across the other two axes.
      if (moved.max[u] <= other.min[u] || moved.min[u] >= other.max[u]) continue;
      if (moved.max[v] <= other.min[v] || moved.min[v] >= other.max[v]) continue;
      for (const delta of [other.max[axis] - moved.min[axis], other.min[axis] - moved.max[axis]]) {
        if (Math.abs(delta) <= FACE_SNAP_RADIUS && (best === undefined || Math.abs(delta) < Math.abs(best))) best = delta;
      }
    }
    snapped[axis] =
      best !== undefined ? candidatePosition[axis] + best : Math.round(candidatePosition[axis] / MOVE_STEP) * MOVE_STEP || 0;
  }
  return snapped;
};

/**
 * Whether the Segment at `index`, placed at `candidatePosition`/
 * `candidateOrientation` (a live drag's candidate transform, not necessarily
 * its currently-stored one), overlaps any *other* Segment's Footprint — the
 * live overlap-feedback primitive (ticket 04). Each Footprint is grown by its
 * own `clearance` before testing (`inflateBox`), and overlap itself is the
 * full oriented-box SAT test (`obbsOverlap`), so this is robust to any
 * rotation either Segment is at, not just axis-aligned placements.
 *
 * Deliberately excludes the Segment's own immediate chain neighbors (`index -
 * 1`, `index + 1`) — their Footprints are *supposed* to touch exactly at the
 * shared Socket by construction (every Module's Footprint reaches its Socket
 * boundary), so flagging that as "overlap" would make ordinary,
 * correctly-connected Segments permanently show red. Same "the Track's own
 * two natural connection points are special" scoping `snapPositionToNeighborSocket`
 * already uses.
 */
export const segmentOverlapsAnyOther = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  candidatePosition: Vec3,
  candidateOrientation: Quat,
  /** The candidate's scale mid-drag (ADR 0062); the Segment's stored scale when omitted. */
  candidateScale?: number,
): boolean => {
  const segment = track[index];
  const module = segment && modules[segment.moduleId];
  if (!module) return false;
  const candidateBox = inflateBox(
    orientBox(scaleBox(module.footprint.bounds, candidateScale ?? segmentScale(segment)), candidatePosition, candidateOrientation),
    module.footprint.clearance,
  );

  return track.some((other, otherIndex) => {
    if (otherIndex === index || otherIndex === index - 1 || otherIndex === index + 1) return false;
    const otherModule = modules[other.moduleId];
    if (!otherModule) return false;
    const otherBox = inflateBox(
      orientBox(scaleBox(otherModule.footprint.bounds, segmentScale(other)), other.position, segmentOrientation(other)),
      otherModule.footprint.clearance,
    );
    return obbsOverlap(candidateBox, otherBox);
  });
};
