import { around, at, flatDisc, heightOf, onTop, orbit, slide, spin, type Extra, type TrackColor } from "./authoring.js";
import type { Segment, Track } from "./Track.js";

/**
 * COG ARENA — a Survival Track shaped like a cog: a round hub with six teeth
 * butted against its rim, a bar turning through the middle, two more
 * orbiting the hub's outer ring, and a floor that is a different material on
 * every tooth: ice, mud, an inflatable, and two belts that run outward,
 * toward the drop.
 *
 * What makes a Survival Track is that it has edges in every direction (the
 * M5 ticket-06 argument, `baseSurvival.ts`) — the shoving is Bump, Hit and
 * Grab, which work everywhere. Everything here exists to take away the place
 * a Player would otherwise stand still: the bars deny the hub, the pistons
 * push outward off three teeth, the belts do it slowly into a spiked wheel,
 * and the ice does it for you.
 *
 * Nothing is placed inside anything else (the user, 2026-09-18: overlapping
 * pieces fight in the render). Every tooth's inner edge touches the hub's rim
 * at its middle, the bars sweep rings that never meet, and every piston and
 * wheel stays clear of both; `survivalArenas.test.ts` holds it to that,
 * through every instant of every Motion.
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

/** The deck everything is played on — the base race's own start height, so a Fall is a real fall. */
const COG_DECK_TOP = 4;
/** How far above a deck a barrier that moves over it rides: clear of its own collision box, which is fitted a little proud of the mesh. */
const COG_RIDE = 0.05;
/** The hub: a 6 m disc at scale 1.5, so nine metres across the radius and a metre and a half thick. */
const COG_HUB_SCALE = 1.5;
const COG_HUB_RADIUS = 6 * COG_HUB_SCALE;
/** A tooth: `platform_4x4x1` at 1.25, five metres square, its inner edge on the hub's rim. */
const COG_TOOTH_SCALE = 1.25;
const COG_TOOTH_SIZE = 4 * COG_TOOTH_SCALE;
const COG_TOOTH_RING = COG_HUB_RADIUS + COG_TOOTH_SIZE / 2;
const COG_TEETH = 6;
const TOOTH_COLOR: readonly TrackColor[] = ["yellow", "green", "red", "yellow", "green", "red"];

const teeth = around(0, 0, COG_TOOTH_RING, COG_TEETH);

/**
 * What each tooth is, going round. The Start's is plain (nobody should spawn
 * on ice) and has nothing moving on it; the ice, mud and bounce teeth each
 * carry a piston; the belts carry a spiked wheel.
 */
type ToothRole = "start" | "piston" | "wheel";
const TOOTH_ROLE: readonly ToothRole[] = ["start", "piston", "wheel", "piston", "wheel", "piston"];
const TOOTH_SURFACE: readonly Extra[] = [
  {},
  { ice: true },
  { conveyor: { preset: "slow", angle: 0 } },
  { mud: true },
  { conveyor: { preset: "slow", angle: 0 } },
  { bounce: true },
];

const hub: Segment[] = flatDisc(0, COG_DECK_TOP, 0, 6, COG_HUB_SCALE);

/**
 * The teeth. A yaw of −angle points a piece's forward straight out from the
 * middle, which is the way a belt at angle 0 runs; the Start is turned half
 * round (a square is the same square), so the spawn grid faces the hub.
 */
const toothFloors: Segment[] = teeth.map(({ x, s, angle }, i) =>
  onTop(`kaykit_platform_4x4x1_${TOOTH_COLOR[i]!}`, x, COG_DECK_TOP, s, {
    scale: COG_TOOTH_SCALE,
    rotation: TOOTH_ROLE[i] === "start" ? Math.PI - angle : -angle,
    ...TOOTH_SURFACE[i],
    ...(TOOTH_ROLE[i] === "start" ? { start: true } : {}),
  }),
);

/**
 * The bar through the middle: 8.8 m long and 4.4 tall, so it is never
 * jumped. Its ends reach 4.54 m out, short of the orbiting bars' 5.02.
 */
const COG_ARM_SCALE = 2.2;
const middleBar: Segment = at("kaykit_barrier_4x1x2_red", 0, COG_DECK_TOP + COG_RIDE, 0, { scale: COG_ARM_SCALE, motion: spin(0.55) });

/**
 * Two bars orbiting the hub's outer ring, opposite each other and turning
 * the other way: each is four metres of wall laid along the radius from 5 m
 * out to 9, two metres tall. Placed a quarter turn round with no yaw, a bar's
 * long axis already points out from the middle, and the orbit's pivot is the
 * hub's centre in its own frame.
 */
const COG_ORBIT_RING = 7;
const orbitBars: Segment[] = [1, -1].map((side) =>
  at(`kaykit_barrier_4x1x2_${side > 0 ? "yellow" : "blue"}`, side * COG_ORBIT_RING, COG_DECK_TOP + COG_RIDE, 0, {
    motion: orbit(-0.8, { x: -side * COG_ORBIT_RING, z: 0 }),
  }),
);

/**
 * A piston on the ice, mud and bounce teeth, sliding straight out toward the
 * tooth's tip: at rest its inner face stands half a metre off the hub's rim,
 * clear of the orbiting bars, and at full throw it stops half a metre short
 * of the tip. Local −Z is outward once the piece is yawed by −angle.
 */
const COG_PISTON_REST = COG_HUB_RADIUS + 1;
const COG_PISTON_THROW = 3;
const pistons: Segment[] = teeth.flatMap(({ angle }, i) => {
  if (TOOTH_ROLE[i] !== "piston") return [];
  return [
    at(
      `kaykit_barrier_4x1x2_${i % 2 === 0 ? "green" : "blue"}`,
      COG_PISTON_REST * Math.sin(angle),
      COG_DECK_TOP + COG_RIDE,
      COG_PISTON_REST * Math.cos(angle),
      {
        rotation: -angle,
        motion: slide({ offset: { s: COG_PISTON_THROW }, period: 3.6, phase: (i * 0.17) % 1 }),
      },
    ),
  ];
});

/** A spiked wheel spinning in the middle of each belt tooth, where the belt carries you. Its 2.1 m reach stays on the tooth. */
const wheels: Segment[] = teeth.flatMap(({ x, s, angle }, i) =>
  TOOTH_ROLE[i] === "wheel"
    ? [at("trap_trapcirclespikedoubleblue", x, COG_DECK_TOP + COG_RIDE, s, { scale: 1.4, rotation: -angle, motion: spin(i === 2 ? 2.1 : -2.3) })]
    : [],
);

/**
 * Outcrops in the notches between the teeth: six lower decks a metre and a
 * half down, so the rim is a ragged thing rather than a circle — somewhere
 * to land from a shove, and to be cornered on. Each carries a bumper, a
 * Prop (ADR 0095) to be leaned on or shoved in after you.
 */
const COG_OUTCROP_RING = 13;
const COG_OUTCROP_TOP = COG_DECK_TOP - 1.5;
const COG_OUTCROP_SCALE = 1.1;
const outcropSpots = around(0, 0, COG_OUTCROP_RING, COG_TEETH, Math.PI / COG_TEETH);
const outcrops: Segment[] = outcropSpots.flatMap(({ x, s, angle }, i) => [
  onTop(`kaykit_platform_4x4x1_${i % 2 === 0 ? "blue" : "green"}`, x, COG_OUTCROP_TOP, s, { scale: COG_OUTCROP_SCALE, rotation: -angle }),
  at(`kaykit_ball_${(["red", "yellow", "green", "blue"] as const)[i % 4]!}`, x, COG_OUTCROP_TOP, s, { scale: 0.8, prop: true }),
]);

/** Flags on the Start tooth's two outer corners and on each outcrop's, so the rim reads as a rim in the dark. */
const flagAt = (x: number, top: number, s: number, i: number): Segment =>
  at(`kaykit_flag_C_${(["yellow", "red", "green", "blue"] as const)[i % 4]!}`, x, top, s, { scale: 1.2 });
const cornersOut = (centreRadius: number, half: number, angle: number, inset: number) =>
  [-1, 1].map((side) => {
    const radial = centreRadius + half - inset;
    const across = side * (half - inset);
    return { x: radial * Math.sin(angle) + across * Math.cos(angle), s: radial * Math.cos(angle) - across * Math.sin(angle) };
  });
const flags: Segment[] = [
  ...teeth.flatMap(({ angle }, i) =>
    TOOTH_ROLE[i] === "start" ? cornersOut(COG_TOOTH_RING, COG_TOOTH_SIZE / 2, angle, 0.6).map(({ x, s }, k) => flagAt(x, COG_DECK_TOP, s, k)) : [],
  ),
  ...outcropSpots.flatMap(({ angle }, i) =>
    cornersOut(COG_OUTCROP_RING, 2 * COG_OUTCROP_SCALE, angle, 0.6).map(({ x, s }, k) => flagAt(x, COG_OUTCROP_TOP, s, i + k)),
  ),
];

/** Columns dropping out of sight under the hub, every tooth and every outcrop — drawn, never landed on: each stops short of the deck above it. */
const columnUnder = (x: number, deckBottom: number, s: number, scale: number): Segment =>
  at("kaykit_pillar_2x2x8", x, deckBottom - 0.1 - heightOf("kaykit_pillar_2x2x8", scale), s, { scale });
const columns: Segment[] = [
  columnUnder(0, COG_DECK_TOP - COG_HUB_SCALE, 0, 2),
  ...teeth.map(({ x, s }) => columnUnder(x, COG_DECK_TOP - COG_TOOTH_SCALE, s, 1.25)),
  ...outcropSpots.map(({ x, s }) => columnUnder(x, COG_OUTCROP_TOP - COG_OUTCROP_SCALE, s, 1)),
];

export const COG_ARENA_TRACK: Track = [...hub, ...toothFloors, middleBar, ...orbitBars, ...pistons, ...wheels, ...outcrops, ...flags, ...columns];
