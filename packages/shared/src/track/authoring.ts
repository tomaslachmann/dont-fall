import { yawQuat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat } from "../math/vec3.js";
import { ASSET_PLACEMENT_MODULES } from "./assetModules.js";
import type { MotionEasing, SegmentMotion } from "./Motion.js";
import { QUARTER_ARC_CENTRES } from "./quarterAssetDefs.js";
import type { Segment } from "./Track.js";

/**
 * The placement kit the code-authored Tracks share (`spinCycle.ts`,
 * `slipStream.ts`, `cogArena.ts`, `skyRings.ts`).
 *
 * `baseRace.ts` grew these helpers privately and proved them; a second
 * hand-authored course would have copied them, a fourth would have copied
 * them four times, so they moved here as they were. The seed itself is left
 * alone on purpose — it is the one Track the API syncs on boot (ADR 0078),
 * verified end to end, and rewriting it to import this file would put the
 * boot seed at risk for no gain.
 *
 * The convention every consumer follows, stated once: a course runs along
 * **−Z**, so a placement names `s`, the distance forward from the Track's
 * origin (world z = −s), `x` across it (+ is right, looking along the run)
 * and the height of the deck top it stands on. Nothing here places anything
 * relative to anything else — every helper takes absolute course
 * coordinates, so a section can be moved or resized without re-measuring
 * its neighbours.
 */

/** The four paints every KayKit platformer piece comes in. */
export type TrackColor = "blue" | "green" | "red" | "yellow";

/** Everything a placement may carry beyond where it is. */
export type Extra = Omit<Partial<Segment>, "moduleId" | "position">;

/** Places `moduleId` with its Asset pivot at (`x`, `y`) and `s` metres along the course. */
export const at = (moduleId: string, x: number, y: number, s: number, extra: Extra = {}): Segment => {
  if (!ASSET_PLACEMENT_MODULES[moduleId]) throw new Error(`unknown Asset "${moduleId}"`);
  return { moduleId, position: { x, y, z: -s }, rotation: 0, ...extra };
};

/** `moduleId`'s footprint, or a throw naming it — every helper below reads it. */
const boundsOf = (moduleId: string) => {
  const module = ASSET_PLACEMENT_MODULES[moduleId];
  if (!module) throw new Error(`unknown Asset "${moduleId}"`);
  return module.footprint.bounds;
};

/** How far above its pivot `moduleId`'s footprint tops out, at `scale`. */
export const heightOf = (moduleId: string, scale = 1): number => {
  const { center, halfExtents } = boundsOf(moduleId);
  return (center.y + halfExtents.y) * scale;
};

/** How deep along Z `moduleId`'s footprint is, at `scale`. */
const depthOf = (moduleId: string, scale = 1): number => boundsOf(moduleId).halfExtents.z * 2 * scale;

/** A level piece whose walking surface lands exactly on `top`. */
export const onTop = (moduleId: string, x: number, top: number, s: number, extra: Extra = {}): Segment =>
  at(moduleId, x, top - heightOf(moduleId, extra.scale ?? 1), s, extra);

/**
 * A piece sunk until its top sits `proud` above the deck it stands on — how
 * a Spring pad or a spike plate is seated. There is no autostep, so a pad a
 * Character would have to jump onto is a wall; 2 cm proud still puts a
 * standing capsule inside its trigger.
 */
export const flushOn = (moduleId: string, x: number, deckTop: number, s: number, extra: Extra = {}, proud = 0.02): Segment =>
  onTop(moduleId, x, deckTop + proud, s, extra);

// --- Motion ----------------------------------------------------------------

/** A spin about the piece's own vertical axis, through its pivot. */
export const spin = (speed: number, startAngle = 0): SegmentMotion => ({
  spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed, ...(startAngle === 0 ? {} : { startAngle }) },
});

/** A spin about a vertical axis `pivot` metres from the piece's own — a piece carried round a carousel. */
export const orbit = (speed: number, pivot: { x: number; z: number }, startAngle = 0): SegmentMotion => ({
  spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: pivot.x, y: 0, z: pivot.z }, speed, ...(startAngle === 0 ? {} : { startAngle }) },
});

export interface SwingOptions {
  amplitude: number;
  period: number;
  phase?: number;
  easing?: MotionEasing;
  pause?: number;
}

/** A swing back and forth about the line through `pivot` along `axis` (the Segment's own frame). */
export const swing = (
  axis: { x: number; y: number; z: number },
  pivot: { x: number; y: number; z: number },
  { amplitude, period, phase = 0, easing = "easeInOut", pause = 0 }: SwingOptions,
): SegmentMotion => ({
  swing: { axis, pivot, amplitude, period, easing, ...(pause === 0 ? {} : { pause }), ...(phase === 0 ? {} : { phase }) },
});

export interface SlideOptions {
  /** In world metres, before `scale` divides back out: `x` across the course, `s` along it, `y` up. */
  offset: { x?: number; y?: number; s?: number };
  scale?: number;
  period: number;
  phase?: number;
  easing?: MotionEasing;
  pause?: number;
}

/**
 * A slide by `offset` in world metres. The Motion lives in the Segment's
 * scaled frame (ADR 0062), so a world offset is divided back out; a course
 * offset of `s` is forward, which is −Z. Never −0: it would not survive a
 * JSON round trip.
 */
export const slide = ({ offset, scale = 1, period, phase = 0, easing = "easeInOut", pause = 0.4 }: SlideOptions): SegmentMotion => ({
  slide: {
    offset: { x: (offset.x ?? 0) / scale, y: (offset.y ?? 0) / scale, z: (0 - (offset.s ?? 0)) / scale },
    period,
    easing,
    ...(pause === 0 ? {} : { pause }),
    ...(phase === 0 ? {} : { phase }),
  },
});

// --- Ramps -----------------------------------------------------------------

/**
 * Every KayKit `platform_slope_WxDxH` climbs at the same 26.6°: its walking
 * face runs from `H − D/2` at the +Z edge up to `H` at the −Z edge, measured
 * off the real files. So a ramp is seated by sinking that base into the deck
 * it leaves, and it delivers `D/2` of rise over `D` of run — comfortably
 * under {@link WALKABLE_SLOPE_MAX_ANGLE}, so a Character walks it instead of
 * Sliding down it.
 */
const rampRise = (moduleId: string, scale = 1): number => depthOf(moduleId, scale) / 2;

/**
 * A ramp whose foot is flush with `deckTop` at `sFoot`, climbing forward.
 * Its head is {@link rampRise} higher, `depthOf` metres further along.
 */
export const rampUp = (moduleId: string, x: number, deckTop: number, sFoot: number, extra: Extra = {}): Segment => {
  const scale = extra.scale ?? 1;
  const depth = depthOf(moduleId, scale);
  return at(moduleId, x, deckTop - (heightOf(moduleId, scale) - rampRise(moduleId, scale)), sFoot + depth / 2, extra);
};

// --- Structures ------------------------------------------------------------

export interface GantryOptions {
  color: TrackColor;
  /** The underside of the beam — what a hanging obstacle visibly hangs from. */
  beamBottom: number;
  s: number;
  /** Where the gantry straddles the course. */
  x?: number;
  /** Half the distance between the two pillars. */
  halfSpan?: number;
  /** The beam's scale: `platform_6x2x1` is 6 × 1 × 2, so 3 spans 18 m. */
  beamScale?: number;
}

/** Two pillars and a beam over the course — what a swinging obstacle hangs from. */
export const gantry = ({ color, beamBottom, s, x = 0, halfSpan = 8.5, beamScale = 3 }: GantryOptions): Segment[] => {
  const pillarScale = 1.5; // 2.4 across, 12 tall
  const pillarHeight = heightOf("kaykit_pillar_2x2x8", pillarScale);
  return [
    at("kaykit_pillar_2x2x8", x - halfSpan, beamBottom - pillarHeight, s, { scale: pillarScale }),
    at("kaykit_pillar_2x2x8", x + halfSpan, beamBottom - pillarHeight, s, { scale: pillarScale }),
    at(`kaykit_platform_6x2x1_${color}`, x, beamBottom, s, { scale: beamScale }),
  ];
};

/**
 * A round deck of `radius` metres about (`x`, `s`), built the way the base
 * survival arena is: four quarter circles inside four quarter curves, turned
 * about their shared arc centre ({@link QUARTER_ARC_CENTRES}) so one `scale`
 * fills the whole circle. Eight Segments, and a Motion given here turns about
 * the disc's centre, so it spins all eight as one.
 */
export const disc = (x: number, top: number, s: number, radius: number, extra: Extra = {}): Segment[] => {
  // The quarter circle fills 0..scale, the quarter curve scale..2·scale, and
  // both are exactly `scale` tall — so one scale of half the radius builds the
  // whole disc and seats it. A Segment's scale tops out at 4 (ADR 0062), so a
  // disc reaches 8 m and no further.
  const scale = radius / 2;
  const quarters = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const y = top - scale;
  const quarter = (moduleId: string, rotation: number): Segment => {
    // Each piece is centred on its own square, so its pivot sits off the arc
    // centre by `-arc`, turned with it — and the Motion's pivot, authored
    // about the disc's centre, is moved into the piece's frame by the same.
    const arc = QUARTER_ARC_CENTRES[moduleId]!;
    const offset = rotateVec3ByQuat({ x: -arc.x * scale, y: 0, z: -arc.z * scale }, yawQuat(rotation));
    const motion = extra.motion && aboutPoint(extra.motion, { x: arc.x, y: 0, z: arc.z });
    return at(moduleId, x + offset.x, y, s - offset.z, { ...extra, rotation, scale, ...(motion ? { motion } : {}) });
  };
  return [
    ...quarters.map((rotation) => quarter("kaykit_platform_quarter_circle_blue", rotation)),
    ...quarters.map((rotation) => quarter("kaykit_platform_quarter_curve_blue", rotation)),
  ];
};

/** The quarter pieces a {@link flatDisc} of each size is built from (ADR 0100): a curve N×N wraps the circle (N/2)×(N/2). */
const FLAT_DISC_QUARTERS = {
  2: { circle: "kaykit_platform_quarter_circle_blue", curve: "kaykit_platform_quarter_curve_blue" },
  4: { circle: "kaykit_platform_quarter_circle_2x2x1_blue", curve: "kaykit_platform_quarter_curve_4x4x1_blue" },
  6: { circle: "kaykit_platform_quarter_circle_3x3x1_blue", curve: "kaykit_platform_quarter_curve_6x6x1_blue" },
  8: { circle: "kaykit_platform_quarter_circle_4x4x1_blue", curve: "kaykit_platform_quarter_curve_8x8x1_blue" },
} as const;

/**
 * A round deck `size` × `scale` metres in radius and `scale` metres thick,
 * from the sized quarter pieces (ADR 0100): four quarter circles inside four
 * quarter curves, seated exactly edge to edge. Unlike {@link disc}, whose
 * thickness grows with its radius, this one stays a slab, so a deck can butt
 * against it without being four metres deep. Eight Segments: the circles
 * first, then the curves, each four turned 0, ½π, π and −½π.
 */
export const flatDisc = (x: number, top: number, s: number, size: 2 | 4 | 6 | 8, scale = 1, extra: Extra = {}): Segment[] => {
  const { circle, curve } = FLAT_DISC_QUARTERS[size];
  const quarters = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const quarter = (moduleId: string, rotation: number): Segment => {
    const arc = QUARTER_ARC_CENTRES[moduleId]!;
    const offset = rotateVec3ByQuat({ x: -arc.x * scale, y: 0, z: -arc.z * scale }, yawQuat(rotation));
    return at(moduleId, x + offset.x, top - scale, s - offset.z, { ...extra, rotation, scale });
  };
  return [...quarters.map((rotation) => quarter(circle, rotation)), ...quarters.map((rotation) => quarter(curve, rotation))];
};

/** `motion` with its spin and swing pivots moved by `by`, in the Segment's own frame — a slide has no pivot to move. */
const aboutPoint = (motion: SegmentMotion, by: { x: number; y: number; z: number }): SegmentMotion => ({
  ...motion,
  ...(motion.spin ? { spin: { ...motion.spin, pivot: addVec3(motion.spin.pivot, by) } } : {}),
  ...(motion.swing ? { swing: { ...motion.swing, pivot: addVec3(motion.swing.pivot, by) } } : {}),
});

/** `count` points evenly around a circle of `radius` about (`x`, `s`), starting at `startAngle` (0 is straight ahead). */
export const around = (
  x: number,
  s: number,
  radius: number,
  count: number,
  startAngle = 0,
): { x: number; s: number; angle: number }[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = startAngle + (i * 2 * Math.PI) / count;
    return { x: x + radius * Math.sin(angle), s: s + radius * Math.cos(angle), angle };
  });

// --- Laying a course out ---------------------------------------------------

/** Where a section begins: `s` along the course, `top` the deck height it starts from. */
export interface Cursor {
  s: number;
  top: number;
}

/** A laid-out section: its pieces, how far it runs along the course, and how much higher it leaves the next one. */
export interface Laid {
  segments: Segment[];
  length: number;
  rise?: number;
}

export type Section = (from: Cursor) => Laid;

/**
 * Runs the sections in order from `start`, handing each the cursor the last
 * one left behind, and remembers where each began — a walk test steers by
 * those, so a section can grow without the test being re-measured.
 */
export const layOut = <Name extends string>(
  sections: readonly (readonly [Name, Section])[],
  start: Cursor,
): { segments: Segment[]; starts: Record<Name, Cursor>; end: Cursor } => {
  const cursor: Cursor = { ...start };
  const segments: Segment[] = [];
  const starts = {} as Record<Name, Cursor>;
  for (const [name, section] of sections) {
    starts[name] = { ...cursor };
    const laid = section(cursor);
    segments.push(...laid.segments);
    cursor.s += laid.length;
    cursor.top += laid.rise ?? 0;
  }
  return { segments, starts, end: { ...cursor } };
};

// --- Hung obstacles --------------------------------------------------------

/** What a hung obstacle needs from its caller, plus where to hang its gantry. */
export interface Hung {
  segment: Segment;
  /** World height of the axle the piece swings about — where a gantry's beam belongs. */
  hubY: number;
}

export interface HammerOptions {
  x: number;
  deckTop: number;
  s: number;
  scale?: number;
  period: number;
  /** Radians either side of straight down. */
  amplitude?: number;
  phase?: number;
  /** How far the head clears the deck at the bottom of its swing. */
  clearance?: number;
}

/**
 * `trap_hammerbig` hung head-down and swung across the course, measured off
 * the real file: the piece lies along its own Z with the head at −Z and its
 * hub at (0, 1.25, 1.65); pitched −90° it hangs head-down from that hub, and
 * a quarter-turn yaw swings it across the lane about the hub's axle. Hung,
 * the hub lands `hub.z·scale` above the pivot and `hub.y·scale` to its −X, so
 * the placement shifts back to put the head over `x`.
 */
export const hangingHammer = ({ x, deckTop, s, scale = 1.5, period, amplitude = 1.05, phase = 0, clearance = 0.35 }: HammerOptions): Hung => {
  const hub = { x: 0, y: 1.25, z: 1.65 };
  const reach = 2.95; // the head's lowest point below the pivot once hung
  const originY = deckTop + clearance + reach * scale;
  return {
    segment: at("trap_hammerbig", x + hub.y * scale, originY, s, {
      rotation: Math.PI / 2,
      pitch: -Math.PI / 2,
      scale,
      motion: swing({ x: 1, y: 0, z: 0 }, hub, { amplitude, period, phase }),
    }),
    hubY: originY + hub.z * scale,
  };
};

export interface WreckingBallOptions {
  x: number;
  deckTop: number;
  s: number;
  scale?: number;
  period: number;
  amplitude?: number;
  phase?: number;
  clearance?: number;
  /** Which way it swings: `across` sweeps the lane, `along` swings up and down the course. */
  axis?: "across" | "along";
}

/** `trap_trapball` on its chain — the chain's own top is 7.52 above the pivot, measured. */
export const wreckingBall = ({
  x,
  deckTop,
  s,
  scale = 1,
  period,
  amplitude = 0.95,
  phase = 0,
  clearance = 0.25,
  axis = "across",
}: WreckingBallOptions): Hung => {
  const CHAIN_TOP = 7.52;
  const pivot = { x: 0, y: CHAIN_TOP, z: 0 };
  return {
    segment: at("trap_trapball", x, deckTop + clearance, s, {
      scale,
      motion: swing(axis === "across" ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }, pivot, { amplitude, period, phase }),
    }),
    hubY: deckTop + clearance + CHAIN_TOP * scale,
  };
};

// --- Scenery runs ----------------------------------------------------------

/** Which railing a run is built from — every one is 2 m long, 1.2 m tall and stands on the deck. */
export type RailingStyle = "single" | "double" | "padded";

/**
 * A line of railings along the course at `x`, covering `sFrom` to `sTo`.
 * Scenery blocks a Character that runs into it (CONTEXT.md: Scenery), so a
 * rail is a real edge you have to jump rather than walk off — which is the
 * whole reason a safe branch gets them and a risky one does not.
 */
export const sideRail = (
  color: TrackColor,
  x: number,
  top: number,
  sFrom: number,
  sTo: number,
  style: RailingStyle = "double",
): Segment[] => {
  const count = Math.max(1, Math.round((sTo - sFrom) / 2));
  return Array.from({ length: count }, (_, i) =>
    at(`kaykit_railing_straight_${style}_${color}`, x, top, sFrom + 1 + i * 2, { rotation: Math.PI / 2 }),
  );
};

/** A line of railings across the course at `s`, covering `xFrom` to `xTo`. */
export const crossRail = (
  color: TrackColor,
  top: number,
  s: number,
  xFrom: number,
  xTo: number,
  style: RailingStyle = "double",
): Segment[] => {
  const count = Math.max(1, Math.round((xTo - xFrom) / 2));
  return Array.from({ length: count }, (_, i) => at(`kaykit_railing_straight_${style}_${color}`, xFrom + 1 + i * 2, top, s));
};

// --- Pitched decks ---------------------------------------------------------

/**
 * A deck tilted by `pitch` whose top centre lands exactly on (`topS`, `topH`)
 * — the pivot sits the deck's own thickness below that top, along the tilted
 * up axis. Positive pitches climb forward; negative ones fall away, which is
 * how a slide steeper than a ramp Asset can go is authored.
 */
export const pitchedDeck = (moduleId: string, x: number, topS: number, topH: number, pitch: number, extra: Extra = {}): Segment => {
  const thickness = heightOf(moduleId, extra.scale ?? 1);
  // Local up (0, t, 0) pitched is (0, t·cos, t·sin) in world — +z is back down the course.
  return at(moduleId, x, topH - thickness * Math.cos(pitch), topS + thickness * Math.sin(pitch), { pitch, ...extra });
};

/** A piece standing `along` metres up a pitched deck from its top centre, tilted with it. */
export const onPitched = (
  moduleId: string,
  x: number,
  topS: number,
  topH: number,
  pitch: number,
  along: number,
  extra: Extra = {},
): Segment => at(moduleId, x, topH + along * Math.sin(pitch), topS + along * Math.cos(pitch), { pitch, ...extra });

/**
 * Centres for `count` pieces of `depth` laid between `sFrom` and `sTo` with
 * the gaps shared out evenly — so an arm of a fork is described by where it
 * starts and ends rather than by arithmetic its neighbours have to agree
 * with. A single piece is centred.
 */
export const chainCentres = (sFrom: number, sTo: number, count: number, depth: number): number[] => {
  if (count < 2) return [(sFrom + sTo) / 2];
  const gap = (sTo - sFrom - count * depth) / (count - 1);
  return Array.from({ length: count }, (_, i) => sFrom + depth / 2 + i * (depth + gap));
};

/** The same Segments with one of them marked as the Track's Start (CONTEXT.md: Start) — one at most, by index. */
export const withStartAt = (segments: readonly Segment[], index: number): Segment[] =>
  segments.map((segment, i) => (i === index ? { ...segment, start: true } : { ...segment }));
