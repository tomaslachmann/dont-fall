import { around, at, flatDisc, heightOf, onTop, orbit, slide, spin, type Extra, type TrackColor } from "./authoring.js";
import type { Segment, Track } from "./Track.js";

/**
 * COG ARENA — a Survival Track built as a machine on three levels, so being
 * shoved off the top starts a comeback instead of ending the Round.
 *
 * - **The cog** (the top): a round hub with eight teeth butted against its
 *   rim. A tall bar turns through the hub's middle and can never be jumped;
 *   two low bars sweep its outer band and always can be, if you time it
 *   (Jump Club's whole game). The teeth are the Start, ice, mud, an
 *   inflatable, two belts running outward into spiked wheels, and two plain
 *   ones. Five of them carry a piston that shoves you toward the tip.
 * - **The ledges** (1.5 m down): eight inflatable outcrops in the notches
 *   between the teeth. Fall off the cog between two teeth and you land on one;
 *   jump on it, and the rebound puts you back on the cog.
 * - **The rim** (2.5 m down): a ring of planks all the way round, narrow,
 *   with two low bars running round it. It catches a Player thrown clear of
 *   the tips, and from anywhere on it a ledge is one jump up.
 *
 * What makes a Survival Track is edges in every direction (the M5 ticket-06
 * argument, `baseSurvival.ts`). The shoving is Bump, Hit and Grab, which work
 * everywhere, and everything here exists to take away the place a Player would
 * otherwise stand still. The Start tooth is the one place nothing moves, which
 * makes it the place everyone fights over.
 *
 * Nothing is placed inside anything else (ADR 0106). Every tooth touches the
 * hub's rim at its middle, the bars sweep rings that never meet, and every
 * piston and wheel stays clear of both. `survivalArenas.test.ts` holds it to
 * that through every instant of every Motion.
 *
 * Published to a running API by `pnpm publish:tracks`, like the other
 * authored Tracks — content, not the boot seed (ADR 0078).
 */
export const COG_ARENA_TRACK_ID = "cog-arena";
export const COG_ARENA_NAME = "Cog Arena";
/** Three minutes, like the base arena: a Survival Round ends when the Survivor Target is met, and the clock is only the backstop. */
export const COG_ARENA_TIME_LIMIT_MS = 3 * 60_000;
/** Last one standing. */
export const COG_ARENA_SURVIVOR_TARGET = 1;
export const COG_ARENA_ENVIRONMENT = "night" as const;

/** The cog's deck — the base race's own start height, so a Fall is a real fall. */
const COG_DECK_TOP = 4;
/** How far above a deck a barrier that moves over it rides: clear of its own collision box, which is fitted a little proud of the mesh (ADR 0106). */
const COG_RIDE = 0.05;

// --- The cog --------------------------------------------------------------

/** The hub: a 6 m disc at scale 1.5, so nine metres to its rim and a metre and a half thick. */
const COG_HUB_SCALE = 1.5;
const COG_HUB_RADIUS = 6 * COG_HUB_SCALE;
/** A tooth: `platform_4x4x1` at 1.25, five metres square, its inner edge on the hub's rim. */
const COG_TOOTH_SCALE = 1.25;
const COG_TOOTH_SIZE = 4 * COG_TOOTH_SCALE;
const COG_TOOTH_RING = COG_HUB_RADIUS + COG_TOOTH_SIZE / 2;
const COG_TEETH = 8;

const teeth = around(0, 0, COG_TOOTH_RING, COG_TEETH);

/**
 * Each tooth going round: its paint, its floor and what stands on it. The
 * Start is plain and empty (nobody should spawn on ice, or in front of a
 * piston); a belt carries you into a spiked wheel; a piston shoves you at the
 * tip.
 */
interface Tooth {
  color: TrackColor;
  floor: Extra;
  on: "start" | "piston" | "wheel";
}
const OUTWARD_BELT: Extra = { conveyor: { preset: "slow", angle: 0 } };
const TEETH: readonly Tooth[] = [
  { color: "yellow", floor: {}, on: "start" },
  { color: "blue", floor: { ice: true }, on: "piston" },
  { color: "red", floor: OUTWARD_BELT, on: "wheel" },
  { color: "green", floor: { mud: true }, on: "piston" },
  { color: "yellow", floor: {}, on: "piston" },
  { color: "red", floor: OUTWARD_BELT, on: "wheel" },
  { color: "green", floor: { bounce: true }, on: "piston" },
  { color: "blue", floor: {}, on: "piston" },
];

const hub: Segment[] = flatDisc(0, COG_DECK_TOP, 0, 6, COG_HUB_SCALE);

/**
 * The teeth. A yaw of −angle points a piece's forward straight out from the
 * middle, which is the way a belt at angle 0 runs. The Start is turned half
 * round (a square is the same square), so the spawn grid faces the hub.
 */
const toothFloors: Segment[] = teeth.map(({ x, s, angle }, i) => {
  const tooth = TEETH[i]!;
  return onTop(`kaykit_platform_4x4x1_${tooth.color}`, x, COG_DECK_TOP, s, {
    scale: COG_TOOTH_SCALE,
    rotation: tooth.on === "start" ? Math.PI - angle : -angle,
    ...tooth.floor,
    ...(tooth.on === "start" ? { start: true } : {}),
  });
});

/**
 * The bar through the middle: 8.8 m long and 4.4 tall, never jumped, so the
 * middle of the hub is only crossed behind it. Its ends reach 4.54 m out.
 */
const middleBar: Segment = at("kaykit_barrier_4x1x2_red", 0, COG_DECK_TOP + COG_RIDE, 0, { scale: 2.2, motion: spin(0.55) });

/**
 * Two low bars sweeping the hub's outer band from 5 m out to 9, opposite each
 * other and turning the other way from the middle one. Each is a metre tall,
 * so every pass is a jump: miss it and you are carried into a tooth, or off
 * between two of them. Placed a quarter turn round with no yaw, a bar's long
 * axis already points out from the middle, and the orbit's pivot is the hub's
 * centre in its own frame.
 */
const COG_SWEEP_RING = 7;
const hubSweepers: Segment[] = [1, -1].map((side) =>
  at(`kaykit_barrier_4x1x1_${side > 0 ? "yellow" : "blue"}`, side * COG_SWEEP_RING, COG_DECK_TOP + COG_RIDE, 0, {
    motion: orbit(-0.6, { x: -side * COG_SWEEP_RING, z: 0 }),
  }),
);

/**
 * A piston on five teeth, sliding straight out toward the tip. At rest its
 * inner face stands half a metre off the hub's rim, clear of the sweepers, and
 * at full throw it stops half a metre short of the tip. Local −Z is outward
 * once the piece is yawed by −angle.
 */
const COG_PISTON_REST = COG_HUB_RADIUS + 1;
const COG_PISTON_THROW = 3;
const pistons: Segment[] = teeth.flatMap(({ angle }, i) =>
  TEETH[i]!.on === "piston"
    ? [
        at(
          `kaykit_barrier_4x1x2_${i % 2 === 0 ? "green" : "blue"}`,
          COG_PISTON_REST * Math.sin(angle),
          COG_DECK_TOP + COG_RIDE,
          COG_PISTON_REST * Math.cos(angle),
          { rotation: -angle, motion: slide({ offset: { s: COG_PISTON_THROW }, period: 3.6, phase: (i * 0.23) % 1 }) },
        ),
      ]
    : [],
);

/** A spiked wheel spinning in the middle of each belt tooth, where the belt carries you (a Spiked Asset always knocks down). Its 2.1 m reach stays on the tooth. */
const wheels: Segment[] = teeth.flatMap(({ x, s, angle }, i) =>
  TEETH[i]!.on === "wheel"
    ? [at("trap_trapcirclespikedoubleblue", x, COG_DECK_TOP + COG_RIDE, s, { scale: 1.4, rotation: -angle, motion: spin(i === 2 ? 2.1 : -2.3) })]
    : [],
);

// --- The ledges -----------------------------------------------------------

/**
 * Eight inflatable outcrops in the notches, a metre and a half below the cog:
 * `platform_4x4x1` at 0.875, three and a half metres square, 29 cm clear of the
 * teeth either side. A bounce deck roughly doubles a jump (ADR 0094), and that
 * is what gets you back up. Every other one carries a bumper, a Prop (ADR
 * 0095) to be shoved off with you.
 */
const COG_LEDGE_TOP = COG_DECK_TOP - 1.5;
const COG_LEDGE_SCALE = 0.875;
const COG_LEDGE_HALF = 2 * COG_LEDGE_SCALE;
const COG_LEDGE_RING = 13.25;
const ledgeSpots = around(0, 0, COG_LEDGE_RING, COG_TEETH, Math.PI / COG_TEETH);
const hasBumper = (i: number): boolean => i % 2 === 0;
const ledges: Segment[] = ledgeSpots.flatMap(({ x, s, angle }, i) => [
  onTop(`kaykit_platform_4x4x1_${(["red", "yellow", "blue", "green"] as const)[i % 4]!}`, x, COG_LEDGE_TOP, s, {
    scale: COG_LEDGE_SCALE,
    rotation: -angle,
    bounce: true,
  }),
  ...(hasBumper(i)
    ? [at(`kaykit_ball_${(["red", "yellow", "green", "blue"] as const)[(i / 2) % 4]!}`, x, COG_LEDGE_TOP, s, { scale: 0.7, prop: true })]
    : []),
]);

// --- The rim --------------------------------------------------------------

/**
 * Twenty-four planks round the outside, a metre below the ledges, their inner
 * corners meeting so the ring is unbroken along its inside edge. The outside
 * edge opens into a 0.54 m notch at every joint, because the ring is a gear's
 * rim, not a road. Each plank is `platform_4x2x1` at 1.027: 4.1 m along the
 * ring, 2.05 across it.
 */
const COG_RIM_TOP = COG_DECK_TOP - 2.5;
const COG_RIM_INNER = 15.6;
const COG_RIM_PLANKS = 24;
const COG_RIM_SCALE = (COG_RIM_INNER * Math.tan(Math.PI / COG_RIM_PLANKS)) / 2;
const COG_RIM_MIDDLE = COG_RIM_INNER + COG_RIM_SCALE;
const rimSpots = around(0, 0, COG_RIM_MIDDLE, COG_RIM_PLANKS);
const rim: Segment[] = rimSpots.map(({ x, s, angle }, i) =>
  onTop(`kaykit_platform_4x2x1_${i % 2 === 0 ? "red" : "yellow"}`, x, COG_RIM_TOP, s, { scale: COG_RIM_SCALE, rotation: -angle }),
);

/**
 * Two bars running round the rim, 60 cm tall and 2.4 m across it, turning the
 * other way from the hub's sweepers: jump them, or ride them off the edge.
 * Placed a quarter turn round with no yaw, as the hub's are; the Motion lives
 * in the scaled frame, so the pivot is divided back out.
 */
const COG_RIM_SWEEP_SCALE = 0.6;
const rimSweepers: Segment[] = [1, -1].map((side) =>
  at(`kaykit_barrier_4x1x1_${side > 0 ? "green" : "red"}`, side * COG_RIM_MIDDLE, COG_RIM_TOP + COG_RIDE, 0, {
    scale: COG_RIM_SWEEP_SCALE,
    motion: orbit(0.3, { x: (-side * COG_RIM_MIDDLE) / COG_RIM_SWEEP_SCALE, z: 0 }),
  }),
);

// --- Dressing -------------------------------------------------------------

/** Flags on the Start tooth's two outer corners and on each bumper-less ledge's, so every level reads as an edge in the dark. */
const flagAt = (x: number, top: number, s: number, i: number): Segment =>
  at(`kaykit_flag_C_${(["yellow", "red", "green", "blue"] as const)[i % 4]!}`, x, top, s, { scale: 1.2 });
const outerCorners = (centreRadius: number, half: number, angle: number, inset: number) =>
  [-1, 1].map((side) => {
    const radial = centreRadius + half - inset;
    const across = side * (half - inset);
    return { x: radial * Math.sin(angle) + across * Math.cos(angle), s: radial * Math.cos(angle) - across * Math.sin(angle) };
  });
const flags: Segment[] = [
  ...teeth.flatMap(({ angle }, i) =>
    TEETH[i]!.on === "start"
      ? outerCorners(COG_TOOTH_RING, COG_TOOTH_SIZE / 2, angle, 0.6).map(({ x, s }, k) => flagAt(x, COG_DECK_TOP, s, k))
      : [],
  ),
  ...ledgeSpots.flatMap(({ angle }, i) =>
    hasBumper(i) ? [] : outerCorners(COG_LEDGE_RING, COG_LEDGE_HALF, angle, 0.5).map(({ x, s }, k) => flagAt(x, COG_LEDGE_TOP, s, i + k)),
  ),
];

/** Columns dropping out of sight under the hub, every tooth, every ledge and every other plank. They are drawn, never landed on: each stops short of the deck above it. */
const columnUnder = (x: number, deckBottom: number, s: number, scale: number): Segment =>
  at("kaykit_pillar_2x2x8", x, deckBottom - 0.1 - heightOf("kaykit_pillar_2x2x8", scale), s, { scale });
const columns: Segment[] = [
  columnUnder(0, COG_DECK_TOP - COG_HUB_SCALE, 0, 2),
  ...teeth.map(({ x, s }) => columnUnder(x, COG_DECK_TOP - COG_TOOTH_SCALE, s, 1.25)),
  ...ledgeSpots.map(({ x, s }) => columnUnder(x, COG_LEDGE_TOP - COG_LEDGE_SCALE, s, 0.9)),
  ...rimSpots.filter((_, i) => i % 2 === 0).map(({ x, s }) => columnUnder(x, COG_RIM_TOP - COG_RIM_SCALE, s, 0.9)),
];

export const COG_ARENA_TRACK: Track = [
  ...hub,
  ...toothFloors,
  middleBar,
  ...hubSweepers,
  ...pistons,
  ...wheels,
  ...ledges,
  ...rim,
  ...rimSweepers,
  ...flags,
  ...columns,
];
