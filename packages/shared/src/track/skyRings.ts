import { around, at, flatDisc, heightOf, onTop, slide, spin, withStartAt, type Extra, type TrackColor } from "./authoring.js";
import type { Segment, Track } from "./Track.js";

/**
 * SKY RINGS — a Survival Track. A hub with six rings around it, joined by
 * spokes out to each one and by an outer bridge between every neighbouring
 * pair, so the floor is a wheel with a great deal of sky in it.
 *
 * Every join is guarded: a bar turns on each spoke and a wall slides along
 * each outer bridge, which means crossing is something you time rather than
 * something you do. The rings are made of different stuff (one ice, one mud,
 * one inflatable, each with two spiked wheels; the plain ones with a bar
 * turning through the middle), so where you are standing decides how well a
 * Bump goes for you.
 *
 * Nothing is placed inside anything else (the user, 2026-09-18: overlapping
 * pieces fight in the render). Every bridge ends exactly at the rims it joins,
 * and everything that turns or slides sweeps ground nothing else stands on;
 * `survivalArenas.test.ts` holds it to that, through every instant of every
 * Motion.
 *
 * Published to a running API by `pnpm publish:tracks` — content, not the boot
 * seed (ADR 0078).
 */
export const SKY_RINGS_TRACK_ID = "sky-rings";
export const SKY_RINGS_NAME = "Sky Rings";
/** Three minutes, the Survival backstop: the Round really ends when the Survivor Target is met. */
export const SKY_RINGS_TIME_LIMIT_MS = 3 * 60_000;
export const SKY_RINGS_SURVIVOR_TARGET = 1;
export const SKY_RINGS_ENVIRONMENT = "sunset" as const;

const SKY_DECK_TOP = 4;
/** How far above a deck a barrier that moves over it rides: clear of its own collision box, which is fitted a little proud of the mesh. */
const SKY_RIDE = 0.05;
/** Every deck is a metre and a half thick: the discs are the sized quarters at 1.5, the bridges `platform_*x2x1` at 1.5. */
const SKY_SCALE = 1.5;
const SKY_HUB_RADIUS = 6 * SKY_SCALE;
const SKY_RING_RADIUS = 4 * SKY_SCALE;
/** A spoke, `platform_4x2x1` at 1.5: six metres out from the hub's rim to a ring's, three across. */
const SKY_SPOKE_LENGTH = 4 * SKY_SCALE;
const SKY_RING_ORBIT = SKY_HUB_RADIUS + SKY_SPOKE_LENGTH + SKY_RING_RADIUS;
const SKY_RINGS = 6;

const rings = around(0, 0, SKY_RING_ORBIT, SKY_RINGS);

/** What each ring's floor is made of, going round; the plain ones get a bar, the others spiked wheels. */
const RING_SURFACE: readonly Extra[] = [{}, { ice: true }, {}, { mud: true }, {}, { bounce: true }];
const hasBar = (i: number): boolean => i % 2 === 0;
const RING_COLOR: readonly TrackColor[] = ["yellow", "blue", "green", "red", "yellow", "green"];

/**
 * The hub, with the Start on its first ring quadrant — everyone begins in the
 * middle, together, which is the only moment of this Round that is not a
 * chase.
 */
const HUB_START_QUARTER = 4;
const hub: Segment[] = withStartAt(flatDisc(0, SKY_DECK_TOP, 0, 6, SKY_SCALE), HUB_START_QUARTER);

const ringFloors: Segment[] = rings.flatMap(({ x, s }, i) => flatDisc(x, SKY_DECK_TOP, s, 4, SKY_SCALE, RING_SURFACE[i]));

/**
 * A point `radial` metres out from a ring's centre and `across` round it —
 * the frame everything placed on a ring is measured in.
 */
const onRing = ({ x, s, angle }: { x: number; s: number; angle: number }, radial: number, across: number) => ({
  x: x + radial * Math.sin(angle) + across * Math.cos(angle),
  s: s + radial * Math.cos(angle) - across * Math.sin(angle),
});

/**
 * The spokes: one bridge from the hub's rim to each ring's, laid along the
 * radius. A yaw of π/2 − angle points a piece's own long axis (local X)
 * straight out from the middle.
 */
const SPOKE_MIDDLE = SKY_HUB_RADIUS + SKY_SPOKE_LENGTH / 2;
const spokeSpots = around(0, 0, SPOKE_MIDDLE, SKY_RINGS);
const spokes: Segment[] = spokeSpots.map(({ x, s, angle }, i) =>
  onTop(`kaykit_platform_4x2x1_${RING_COLOR[i]!}`, x, SKY_DECK_TOP, s, { scale: SKY_SCALE, rotation: Math.PI / 2 - angle }),
);

/**
 * A bar turning on every spoke: six metres on a three-metre bridge, so it
 * sweeps the whole crossing, and only 1.5 m tall, so it can be jumped if you
 * are willing to be in the air over a bridge while someone else is on it.
 */
const spokeBars: Segment[] = spokeSpots.map(({ x, s }, i) =>
  at(`kaykit_barrier_4x1x1_${i % 2 === 0 ? "red" : "blue"}`, x, SKY_DECK_TOP + SKY_RIDE, s, {
    scale: 1.5,
    motion: spin((i % 2 === 0 ? 1 : -1) * (1.3 + i * 0.12)),
  }),
);

/**
 * The outer bridges: one between each neighbouring pair of rings, laid along
 * the chord between their centres and ending on both rims. A yaw of −angle
 * points a piece's long axis tangentially, which is the chord's direction at
 * its own midpoint.
 */
const OUTER_BRIDGE_RADIUS = SKY_RING_ORBIT * Math.cos(Math.PI / SKY_RINGS);
const bridgeSpots = around(0, 0, OUTER_BRIDGE_RADIUS, SKY_RINGS, Math.PI / SKY_RINGS);
const outerBridges: Segment[] = bridgeSpots.map(({ x, s, angle }, i) =>
  onTop(`kaykit_platform_6x2x1_${i % 2 === 0 ? "blue" : "yellow"}`, x, SKY_DECK_TOP, s, { scale: SKY_SCALE, rotation: -angle }),
);

/**
 * A wall sliding the length of each outer bridge, across it: yawed by
 * π/2 − angle its long side lies across the bridge, and its local −Z runs
 * back round the chord, so it rests three metres one way and slides six to
 * three metres the other — stopping short of both rims.
 */
const WALL_REST = 3;
const outerWalls: Segment[] = bridgeSpots.map(({ x, s, angle }, i) =>
  at(`kaykit_barrier_3x1x2_${i % 2 === 0 ? "green" : "red"}`, x + WALL_REST * Math.cos(angle), SKY_DECK_TOP + SKY_RIDE, s - WALL_REST * Math.sin(angle), {
    scale: 1.3,
    rotation: Math.PI / 2 - angle,
    motion: slide({ offset: { s: 2 * WALL_REST }, scale: 1.3, period: 3.4, phase: (i * 0.19) % 1 }),
  }),
);

/** A bar turning through the middle of each plain ring: eight metres, so only a two-metre band at the rim is never swept. */
const ringBars: Segment[] = rings.flatMap(({ x, s }, i) =>
  hasBar(i)
    ? [at(`kaykit_barrier_4x1x1_${i % 4 === 0 ? "yellow" : "green"}`, x, SKY_DECK_TOP + SKY_RIDE, s, { scale: 2, motion: spin((i % 4 === 0 ? -1 : 1) * (1 + i * 0.1)) })]
    : [],
);

/** Two spiked wheels either side of every ice, mud and bounce ring's middle, with a bumper out at the far rim between them. */
const RING_WHEEL_ACROSS = 3.5;
const wheels: Segment[] = rings.flatMap((ring, i) =>
  hasBar(i)
    ? []
    : [-1, 1].map((side) => {
        const { x, s } = onRing(ring, 0, side * RING_WHEEL_ACROSS);
        return at("trap_trapcirclespikedoublegreen", x, SKY_DECK_TOP + SKY_RIDE, s, { scale: 1.2, rotation: -ring.angle, motion: spin(side * 2.2) });
      }),
);

/** Bumpers: four on the hub, clear of the spawn grid, and one on each wheel ring — all Props (ADR 0095), ammunition as much as cover. */
const bumpers: Segment[] = [
  ...around(0, 0, 6.5, 4).map(({ x, s }, i) =>
    at(`kaykit_ball_${(["red", "yellow", "green", "blue"] as const)[i % 4]!}`, x, SKY_DECK_TOP, s, { scale: 0.9, prop: true }),
  ),
  ...rings.flatMap((ring, i) => {
    if (hasBar(i)) return [];
    const { x, s } = onRing(ring, 4, 0);
    return [at(`kaykit_ball_${i % 4 === 1 ? "red" : "blue"}`, x, SKY_DECK_TOP, s, { scale: 0.9, prop: true })];
  }),
];

/** Columns under the hub, every ring and every outer bridge — drawn, never landed on: each stops short of the deck above it. */
const DECK_BOTTOM = SKY_DECK_TOP - SKY_SCALE;
const columns: Segment[] = [
  at("kaykit_pillar_2x2x8", 0, DECK_BOTTOM - 0.1 - heightOf("kaykit_pillar_2x2x8", 2), 0, { scale: 2 }),
  ...rings.map(({ x, s }) => at("kaykit_pillar_2x2x8", x, DECK_BOTTOM - 0.1 - heightOf("kaykit_pillar_2x2x8", 1.5), s, { scale: 1.5 })),
  ...bridgeSpots.map(({ x, s }) => at("kaykit_pillar_1x1x8", x, DECK_BOTTOM - 0.1 - heightOf("kaykit_pillar_1x1x8", 1.5), s, { scale: 1.5 })),
];

/** Flags on the far rim of every ring, and cones scattered on the hub. */
const dressing: Segment[] = [
  ...rings.flatMap((ring, i) =>
    [-1, 1].map((side) => {
      const { x, s } = onRing(ring, hasBar(i) ? 5.2 : 5, side * (hasBar(i) ? 2 : 2.6));
      return at(`kaykit_flag_C_${(["yellow", "red", "green", "blue"] as const)[(i + (side > 0 ? 1 : 0)) % 4]!}`, x, SKY_DECK_TOP, s, {
        scale: 1.2,
      });
    }),
  ),
  ...around(0, 0, 3.5, 8, Math.PI / 8).map(({ x, s }, i) =>
    at(`kaykit_cone_${(["red", "yellow", "green", "blue"] as const)[i % 4]!}`, x, SKY_DECK_TOP, s, { prop: true }),
  ),
];

export const SKY_RINGS_TRACK: Track = [
  ...hub,
  ...ringFloors,
  ...spokes,
  ...spokeBars,
  ...outerBridges,
  ...outerWalls,
  ...ringBars,
  ...wheels,
  ...bumpers,
  ...columns,
  ...dressing,
];
