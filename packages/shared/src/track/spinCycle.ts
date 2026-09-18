import {
  at,
  chainCentres,
  crossRail,
  disc,
  flushOn,
  gantry,
  hangingHammer,
  heightOf,
  layOut,
  onTop,
  orbit,
  rampUp,
  sideRail,
  slide,
  spin,
  wreckingBall,
  type Cursor,
  type Extra,
  type Section,
  type TrackColor,
} from "./authoring.js";
import type { Segment, Track } from "./Track.js";

/**
 * SPIN CYCLE — a Race Track about things that turn. Every section asks the
 * same question a different way: the floor is moving, so when do you step?
 * Carousels you ride across, turntables you hop between, bars that sweep the
 * deck you are standing on, and three places where the course splits and you
 * pick an arm.
 *
 * Authored here as data like the base race (ADR 0078's seed), and published
 * to a running API by `pnpm publish:tracks` rather than synced on boot — it
 * is content, not the seed.
 *
 * Layout convention is {@link ./authoring.ts}'s: the course runs along −Z, a
 * placement names `s` forward (world z = −s), `x` across and the deck top it
 * stands on. Sections are laid from wherever the last one ended, so one can
 * grow without the rest being re-measured.
 *
 * The rest-pose rule every obstacle here obeys: with its Motion stopped the
 * course is still walkable. A bar that sweeps a deck is therefore never
 * centred on it — it is offset until its swept circle leaves a strip, and
 * consecutive bars alternate which side the strip is on, so the route zig-zags
 * instead of waiting.
 */
export const SPIN_CYCLE_TRACK_ID = "spin-cycle";
export const SPIN_CYCLE_NAME = "Spin Cycle";
/** Six minutes: a straight walk with everything stopped is about three, and nothing here stays stopped. */
export const SPIN_CYCLE_TIME_LIMIT_MS = 6 * 60_000;
export const SPIN_CYCLE_ENVIRONMENT = "day" as const;

const LANE_SCALE = 2;
/** The width of a full lane deck — `platform_6x6x1` at {@link LANE_SCALE}. */
export const LANE = 6 * LANE_SCALE;

/** A full-width lane deck on the course's centre line. */
const lane = (color: TrackColor, top: number, s: number, extra: Extra = {}): Segment =>
  onTop(`kaykit_platform_6x6x1_${color}`, 0, top, s, { scale: LANE_SCALE, ...extra });

/** A square deck of `6 · scale` metres anywhere across the course. */
const deck = (color: TrackColor, x: number, top: number, s: number, scale: number, extra: Extra = {}): Segment =>
  onTop(`kaykit_platform_6x6x1_${color}`, x, top, s, { scale, ...extra });

/**
 * A bar spinning flat over a deck. `x` is the axle, not the deck's middle:
 * the swept circle is `2 · scale` metres across, so an axle pushed to one
 * side leaves a strip on the other — the rest-pose rule above, and the reason
 * a Player crosses the deck diagonally instead of standing still.
 */
const sweeper = (
  color: TrackColor,
  x: number,
  deckTop: number,
  s: number,
  { scale, speed, startAngle = 0 }: { scale: number; speed: number; startAngle?: number },
): Segment => at(`kaykit_barrier_4x1x1_${color}`, x, deckTop + 0.02, s, { scale, motion: spin(speed, startAngle) });

/** A column dropping out of sight under a floating deck — drawn, never landed on: its top stops short of the deck. */
const underPillar = (x: number, deckBottom: number, s: number, scale = 1.5): Segment =>
  at("kaykit_pillar_2x2x8", x, deckBottom - 0.1 - heightOf("kaykit_pillar_2x2x8", scale), s, { scale });

/**
 * A fork's signage, hung clear of the route: a sign standing on the deck is
 * a wall, and the one place a Player is looking around is exactly where the
 * course splits.
 */
const SIGN_HEIGHT = 2.6;
const signpost = (moduleId: string, x: number, top: number, s: number): Segment =>
  at(moduleId, x, top + SIGN_HEIGHT, s, { rotation: Math.PI });

/** Four flags round a point, for a place that wants to look like somewhere. */
const flagRing = (top: number, x: number, s: number, spread: number, scale = 1.5): Segment[] =>
  (
    [
      ["red", -spread, -spread],
      ["yellow", spread, -spread],
      ["green", -spread, spread],
      ["blue", spread, spread],
    ] as const
  ).map(([color, dx, ds]) => at(`kaykit_flag_C_${color}`, x + dx, top, s + ds, { scale }));

/** A piece standing on a carousel and turning with it: its own spin, pivoted on the disc's centre. */
const rider = (
  moduleId: string,
  centre: { x: number; s: number },
  offset: { x: number; s: number },
  top: number,
  speed: number,
  extra: Extra = {},
): Segment => {
  const scale = extra.scale ?? 1;
  // The Motion runs inside the Segment's scaled frame (ADR 0062), so the
  // offset back to the disc's centre is divided out before it is used as a pivot.
  return at(moduleId, centre.x + offset.x, top, centre.s + offset.s, {
    ...extra,
    motion: orbit(speed, { x: -offset.x / scale, z: offset.s / scale }),
  });
};

// ---------------------------------------------------------------------------
// The sections, in running order.
// ---------------------------------------------------------------------------

/** The Start: a railed plaza with flags at its corners and a runway out of it. */
const startPlaza: Section = ({ s, top }) => ({
  segments: [
    deck("blue", 0, top, s + 9, 3, { start: true }),
    ...flagRing(top, 0, s + 9, 7),
    ...sideRail("blue", -8.8, top, s + 1, s + 13),
    ...sideRail("blue", 8.8, top, s + 1, s + 13),
    ...crossRail("yellow", top, s + 0.8, -7, 7),
    at("kaykit_signage_arrow_stand_yellow", -5, top, s + 20, { scale: 1.5 }),
    at("kaykit_signage_arrow_stand_yellow", 5, top, s + 20, { scale: 1.5 }),
    lane("yellow", top, s + 24),
  ],
  length: 30,
});

/**
 * Spin gates: four decks, each turned by a different kind of bar. A crossed
 * pair you go round, a single long one you go round the other way, a faster
 * cross, then the base race's staggered pair — the vocabulary of the whole
 * Track, laid out where falling off still only costs you the lead.
 */
export const SPIN_GATE_DS = [6, 18, 30, 42];
const spinGates: Section = ({ s, top }) => {
  const [a, b, c, d] = SPIN_GATE_DS as [number, number, number, number];
  return {
    segments: [
      lane("red", top, s + a),
      sweeper("yellow", 0, top, s + a, { scale: 1.4, speed: 1.5 }),
      sweeper("yellow", 0, top, s + a, { scale: 1.4, speed: 1.5, startAngle: Math.PI / 2 }),
      lane("yellow", top, s + b),
      sweeper("blue", 2, top, s + b, { scale: 2, speed: -1.2 }),
      lane("blue", top, s + c),
      sweeper("red", 0, top, s + c, { scale: 1.4, speed: -2 }),
      sweeper("red", 0, top, s + c, { scale: 1.4, speed: -2, startAngle: Math.PI / 2 }),
      lane("green", top, s + d),
      sweeper("blue", -3, top, s + d - 2.8, { scale: 1.8, speed: 1.8 }),
      sweeper("blue", 3, top, s + d + 2.8, { scale: 1.8, speed: -1.8, startAngle: Math.PI / 2 }),
      ...([
        [-5, a],
        [5, a],
        [-5, c],
        [5, c],
        [-5, d],
        [5, d],
      ] as const).map(([x, ds]) => at("kaykit_cone_red", x, top, s + ds - 5, { prop: true })),
    ],
    length: 48,
  };
};

/** How far apart the three carousels stand, and how wide each one is. */
export const CAROUSEL_RADIUS = 8;
export const CAROUSEL_DS = [10, 27, 44];
const CAROUSEL_SPEEDS = [0.45, -0.5, 0.55];
/** Where a carousel's bar is bolted, and how far out its bumpers ride. */
const CAROUSEL_BAR_X = 3.5;
const CAROUSEL_RIDER_RADIUS = 6;
/**
 * The carousels: three 16 m discs turning under your feet with a metre of
 * open air between them, each with a bar bolted off centre and three bumpers
 * riding its rim. The bar never reaches the disc's left quarter, so there is
 * always a way across — but it is a way across a floor that is taking you
 * sideways while you walk it.
 */
const carousels: Section = ({ s, top }) => ({
  segments: CAROUSEL_DS.flatMap((ds, i) => {
    const speed = CAROUSEL_SPEEDS[i]!;
    const centre = { x: 0, s: s + ds };
    const barColor: TrackColor = i % 2 === 0 ? "yellow" : "red";
    const ballColor: TrackColor = i % 2 === 0 ? "green" : "blue";
    return [
      ...disc(centre.x, top, centre.s, CAROUSEL_RADIUS, { motion: spin(speed) }),
      sweeper(barColor, centre.x + CAROUSEL_BAR_X, top, centre.s, { scale: 1.5, speed: -speed * 2.6 }),
      ...[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((angle) =>
        rider(
          `kaykit_ball_${ballColor}`,
          centre,
          { x: CAROUSEL_RIDER_RADIUS * Math.sin(angle), s: CAROUSEL_RIDER_RADIUS * Math.cos(angle) },
          top,
          speed,
        ),
      ),
      underPillar(centre.x, top - CAROUSEL_RADIUS / 2, centre.s, 2),
    ];
  }),
  length: 54,
});

/** A Checkpoint stop: a still deck, an arch across it, and two flags so it reads as a place to breathe. */
const checkpointStop =
  (order: number, color: TrackColor = "green"): Section =>
  ({ s, top }) => ({
    segments: [
      lane(color, top, s + LANE / 2),
      at("kaykit_arch_wide_yellow", 0, top, s + 8, { scale: LANE_SCALE, checkpoint: { order } }),
      at("kaykit_flag_B_red", -5, top, s + 3, { scale: 1.2 }),
      at("kaykit_flag_B_blue", 5, top, s + 3, { scale: 1.2 }),
    ],
    length: LANE,
  });

/** A hung obstacle and the gantry it visibly hangs from — the pair is always placed together. */
const hungFrom = (color: TrackColor, x: number, { segment, hubY }: { segment: Segment; hubY: number }, s: number, halfSpan = 6): Segment[] => [
  segment,
  ...gantry({ color, beamBottom: hubY + 1.3, s, x, halfSpan, beamScale: (halfSpan * 2) / 6 }),
];

/** Where the first fork's two arms run, and how far along each obstacle sits. */
export const FORK_ONE_LEFT_X = -11;
export const FORK_ONE_RIGHT_X = 9;
export const FORK_ONE_LEFT_DS = [22.5, 33.75, 45, 56.25, 67.5];
const FORK_ONE_CATWALK_TOP_RISE = 6;
export const FORK_ONE_BAR_DS = [36, 48, 60, 72];
/**
 * The first fork. Left is the long way round: five decks at deck height with
 * hammers and wrecking balls over them, wide enough to keep your feet. Right
 * goes over the top: a ramp to a catwalk six metres up, eight metres wide,
 * with bars sweeping it and nothing at the sides — it ends by dropping you
 * back onto the rejoin deck.
 */
const forkOne: Section = ({ s, top }) => {
  const catwalkTop = top + FORK_ONE_CATWALK_TOP_RISE;
  const left = FORK_ONE_LEFT_DS.flatMap((ds, i) => {
    const color: TrackColor = i % 2 === 0 ? "green" : "yellow";
    const deckSegment = deck(color, FORK_ONE_LEFT_X, top, s + ds, 1.5);
    if (i % 2 === 0) {
      return [
        deckSegment,
        ...hungFrom(
          "red",
          FORK_ONE_LEFT_X,
          hangingHammer({ x: FORK_ONE_LEFT_X, deckTop: top, s: s + ds, period: 2.6 + i * 0.2, phase: (i * 0.31) % 1 }),
          s + ds,
        ),
      ];
    }
    return [
      deckSegment,
      ...hungFrom(
        "blue",
        FORK_ONE_LEFT_X,
        wreckingBall({ x: FORK_ONE_LEFT_X, deckTop: top, s: s + ds, period: 3.2, phase: (i * 0.4) % 1 }),
        s + ds,
      ),
    ];
  });
  const right = [
    rampUp("kaykit_platform_slope_6x6x4_red", FORK_ONE_RIGHT_X, top, s + 18, { scale: 2 }),
    onTop("kaykit_platform_6x2x1_blue", FORK_ONE_RIGHT_X, catwalkTop, s + 42, { scale: 4, rotation: Math.PI / 2 }),
    onTop("kaykit_platform_6x2x1_green", FORK_ONE_RIGHT_X, catwalkTop, s + 66, { scale: 4, rotation: Math.PI / 2 }),
    ...FORK_ONE_BAR_DS.map((ds, i) =>
      sweeper(i % 2 === 0 ? "red" : "yellow", FORK_ONE_RIGHT_X + (i % 2 === 0 ? 2.5 : -2.5), catwalkTop, s + ds, {
        scale: 1.6,
        speed: i % 2 === 0 ? 1.7 : -1.9,
        startAngle: Math.PI / 2,
      }),
    ),
  ];
  return {
    segments: [
      deck("yellow", 0, top, s + 9, 3),
      signpost("kaykit_signage_arrows_left_green", -5, top, s + 14),
      signpost("kaykit_signage_arrows_right_blue", 5, top, s + 14),
      ...left,
      ...right,
      deck("red", 0, top, s + 84, 4),
    ],
    length: 96,
  };
};

export const TURNTABLE_RADIUS = 4;
/** Each turntable's middle: across the course, then along it. */
export const TURNTABLE_AT: readonly { x: number; ds: number }[] = [
  { x: 0, ds: 6 },
  { x: 1.5, ds: 16 },
  { x: -1.5, ds: 26 },
  { x: 1.5, ds: 36 },
  { x: 0, ds: 46 },
];
/**
 * Turntables: five eight-metre discs over open air with two metres between
 * them, each turning a different way with a bumper riding either side of its
 * middle. The jump is short — but you take it off a floor that is moving, and
 * land on one that is moving the other way, which is the whole section.
 */
const turntables: Section = ({ s, top }) => ({
  segments: TURNTABLE_AT.flatMap(({ x, ds }, i) => {
    const speed = (i % 2 === 0 ? 1 : -1) * (0.7 + i * 0.12);
    const centre = { x, s: s + ds };
    return [
      ...disc(x, top, centre.s, TURNTABLE_RADIUS, { motion: spin(speed) }),
      // Either side of the middle, so the line a Player crosses on stays open at rest.
      ...[-2.6, 2.6].map((dx) =>
        rider(`kaykit_ball_${i % 2 === 0 ? "red" : "yellow"}`, centre, { x: dx, s: 0 }, top, speed, { scale: 0.7 }),
      ),
      underPillar(x, top - TURNTABLE_RADIUS / 2, centre.s, 1.5),
    ];
  }),
  length: 52,
});

const HAMMER_BRIDGE_DS = [6, 18, 30, 42, 54];
/** How far left of the bridge's middle the Spring pads are sunk — clear of the line a Player walks past the hammers on. */
const HAMMER_BRIDGE_PAD_X = -5;
/**
 * Hammer bridge: five lane decks in a line under a wave of hammers and
 * wrecking balls. Down the left of it, three Spring pads sunk flush with the
 * deck — a pad fires the moment you stand on it, so that side of the bridge
 * is a committed line that throws you most of a deck further on, over
 * whatever was swinging there.
 */
const hammerBridge: Section = ({ s, top }) => ({
  segments: HAMMER_BRIDGE_DS.flatMap((ds, i) => [
    lane(i % 2 === 0 ? "blue" : "red", top, s + ds),
    ...(i % 2 === 0
      ? [
          flushOn(`kaykit_spring_pad_${i === 0 ? "yellow" : "red"}`, HAMMER_BRIDGE_PAD_X, top, s + ds - 4, {
            scale: 1.5,
            launch: { height: 6 },
          }),
        ]
      : []),
    ...(i % 2 === 0
      ? hungFrom(
          "yellow",
          0,
          hangingHammer({ x: 0, deckTop: top, s: s + ds, period: 2.4 + (i % 3) * 0.3, phase: (i * 0.37) % 1 }),
          s + ds,
          8.5,
        )
      : hungFrom(
          "green",
          0,
          wreckingBall({ x: 0, deckTop: top, s: s + ds, period: 3.6, phase: (i * 0.29) % 1 }),
          s + ds,
          8.5,
        )),
  ]),
  length: 60,
});

export const FORK_TWO_ARM_X = [-15, 0, 15] as const;
export const FORK_TWO_BELT_DS = [19.5, 28.5, 37.5, 46.5, 55.5, 64.5, 73.5];
export const FORK_TWO_GAP_DS = [18, 26, 34, 42, 50, 58, 66, 74];
// Laid edge to edge, unlike the other two arms: since ADR 0095 an inflatable
// deck throws a jump more than three metres, and a bounce landing carries on
// bouncing — gaps as well would make this arm a dice roll rather than a route.
export const FORK_TWO_BOUNCE_DS = chainCentres(15, 78, 7, 9);
/**
 * The second fork, three arms wide, over seven and a half metres of open air
 * either side of the middle one. Left is belts running the wrong way with
 * walls sliding over them — slow, but you cannot fall off it. The middle is
 * stepping stones with two-metre gaps, two of which slide out from under the
 * jump. Right is inflatable decks: land hard and it throws you on, land soft
 * and it does nothing.
 */
const forkTwo: Section = ({ s, top }) => {
  const [ax, bx, cx] = FORK_TWO_ARM_X;
  const row = (color: TrackColor, ds: number): Segment[] => FORK_TWO_ARM_X.map((x) => deck(color, x, top, s + ds, 2.5));
  const belt = FORK_TWO_BELT_DS.flatMap((ds, i) => [
    deck(i % 2 === 0 ? "red" : "yellow", ax, top, s + ds, 1.5, {
      conveyor: { preset: i % 2 === 0 ? "slow" : "medium", angle: Math.PI },
    }),
    ...(i === 2 || i === 5
      ? [
          at("kaykit_barrier_2x1x2_blue", ax + 5, top, s + ds, {
            scale: 1.5,
            motion: slide({ offset: { x: -10 }, scale: 1.5, period: 3.4, phase: i * 0.25 }),
          }),
        ]
      : []),
  ]);
  const stones = FORK_TWO_GAP_DS.map((ds, i) =>
    onTop(`kaykit_platform_4x4x1_${i % 2 === 0 ? "green" : "blue"}`, bx, top, s + ds, {
      scale: 1.5,
      ...(i === 2 || i === 5 ? { motion: slide({ offset: { x: i === 2 ? 6 : -6 }, scale: 1.5, period: 3.6, phase: i * 0.2 }) } : {}),
    }),
  );
  const bouncers = FORK_TWO_BOUNCE_DS.map((ds, i) => deck(i % 2 === 0 ? "yellow" : "green", cx, top, s + ds, 1.5, { bounce: true }));
  return {
    segments: [
      ...row("blue", 7.5),
      signpost("kaykit_signage_arrows_left_red", -9, top, s + 12),
      signpost("kaykit_signage_arrow_stand_green", 0, top, s + 12),
      signpost("kaykit_signage_arrows_right_yellow", 9, top, s + 12),
      ...belt,
      ...stones,
      ...bouncers,
      // Seated so the rejoin catches the longest arm where it ends and hands
      // the course on without a gap of its own.
      ...row("blue", 85.5),
    ],
    length: 93,
  };
};

export const SWEEPER_GAUNTLET_DS = [6, 18, 30, 42, 54, 66];
/**
 * The sweeper gauntlet: six lane decks, each with a ten-metre bar turning
 * over it and a wall sliding the other way. The bar's axle is always off
 * centre, so there is always a strip it never reaches — and it is on the
 * other side each time, which is what makes this a run and not a wait.
 */
const sweeperGauntlet: Section = ({ s, top }) => ({
  segments: SWEEPER_GAUNTLET_DS.flatMap((ds, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    return [
      lane(i % 2 === 0 ? "green" : "blue", top, s + ds),
      sweeper(i % 2 === 0 ? "red" : "yellow", side * 2, top, s + ds, { scale: 2.5, speed: side * (1.1 + i * 0.1) }),
      // Parked on the bar's own side, so the strip the bar never reaches is
      // open at rest and only closes when the wall has travelled to it.
      at("kaykit_barrier_2x1x2_red", side * 5, top, s + ds - 4, {
        scale: 1.5,
        motion: slide({ offset: { x: -side * 10 }, scale: 1.5, period: 3.8, phase: i * 0.18 }),
      }),
      underPillar(0, top - 2, s + ds, 2),
    ];
  }),
  length: 72,
});

/** How high each of the ascent's two ramps lifts the course. */
const ASCENT_STEP = 6;
const ASCENT_RAMP_DS = [12, 36];
/** The ascent: two long ramps with a wrecking ball swinging up and down each one, and a landing to catch your breath between them. */
const theAscent: Section = ({ s, top }) => {
  const tiers = [top, top + ASCENT_STEP, top + 2 * ASCENT_STEP];
  return {
    segments: [
      lane("yellow", tiers[0]!, s + 6),
      ...sideRail("yellow", -5.6, tiers[0]!, s + 1, s + 11),
      ...sideRail("yellow", 5.6, tiers[0]!, s + 1, s + 11),
      ...ASCENT_RAMP_DS.flatMap((ds, i) => {
        const deckTop = tiers[i]!;
        const middle = deckTop + ASCENT_STEP / 2;
        const ball = wreckingBall({ x: 0, deckTop: middle, s: s + ds + 6, period: 3.0, phase: i * 0.5, axis: "along" });
        return [
          rampUp(`kaykit_platform_slope_6x6x4_${i === 0 ? "blue" : "green"}`, 0, deckTop, s + ds, { scale: 2 }),
          ...hungFrom("red", 0, ball, s + ds + 6, 8.5),
        ];
      }),
      lane("red", tiers[1]!, s + 30),
      sweeper("blue", 2, tiers[1]!, s + 30, { scale: 2, speed: 1.6 }),
      lane("blue", tiers[2]!, s + 54),
      sweeper("yellow", -2, tiers[2]!, s + 54, { scale: 2, speed: -1.8 }),
      ...sideRail("blue", -5.6, tiers[2]!, s + 49, s + 59),
      ...sideRail("blue", 5.6, tiers[2]!, s + 49, s + 59),
    ],
    length: 60,
    rise: 2 * ASCENT_STEP,
  };
};

export const FORK_THREE_MUD_X = -10;
export const FORK_THREE_ICE_X = 10;
const FORK_THREE_MUD_DS = [22.5, 31.5, 40.5, 49.5];
const FORK_THREE_ICE_DS = [27, 45];
/**
 * The last fork is a straight trade. Left is mud: half speed, railed on both
 * sides, nothing on it. Right is ice: no grip, no rails, and two bars turning
 * over it — the same distance in a third of the time, if you keep your feet.
 */
const forkThree: Section = ({ s, top }) => ({
  segments: [
    deck("green", 0, top, s + 9, 3),
    signpost("kaykit_signage_arrows_left_red", -5, top, s + 14),
    signpost("kaykit_signage_arrows_right_blue", 5, top, s + 14),
    ...FORK_THREE_MUD_DS.map((ds, i) => deck(i % 2 === 0 ? "red" : "yellow", FORK_THREE_MUD_X, top, s + ds, 1.5, { mud: true })),
    ...sideRail("red", FORK_THREE_MUD_X - 4.2, top, s + 27, s + 45),
    ...sideRail("red", FORK_THREE_MUD_X + 4.2, top, s + 27, s + 45),
    ...FORK_THREE_ICE_DS.flatMap((ds, i) => [
      onTop(`kaykit_platform_6x2x1_${i === 0 ? "blue" : "green"}`, FORK_THREE_ICE_X, top, s + ds, {
        scale: 3,
        rotation: Math.PI / 2,
        ice: true,
      }),
      sweeper("yellow", FORK_THREE_ICE_X + (i === 0 ? 1.8 : -1.8), top, s + ds, { scale: 1.2, speed: i === 0 ? 1.9 : -2.1, startAngle: Math.PI / 2 }),
    ]),
    deck("blue", 0, top, s + 66, 4),
  ],
  length: 78,
});

/** One last carousel, turning faster than any of the first three, with four bumpers on it and nothing to hold. */
const finalCarousel: Section = ({ s, top }) => {
  const centre = { x: 0, s: s + 10 };
  const speed = 0.75;
  return {
    segments: [
      ...disc(centre.x, top, centre.s, CAROUSEL_RADIUS, { motion: spin(speed) }),
      sweeper("red", CAROUSEL_BAR_X, top, centre.s, { scale: 1.5, speed: -2.1 }),
      ...[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((angle) =>
        rider("kaykit_ball_yellow", centre, { x: CAROUSEL_RIDER_RADIUS * Math.sin(angle), s: CAROUSEL_RIDER_RADIUS * Math.cos(angle) }, top, speed),
      ),
      underPillar(centre.x, top - CAROUSEL_RADIUS / 2, centre.s, 2),
    ],
    length: 20,
  };
};

/** The finish: the wide sign across a last lane, and a plaza behind it to celebrate on. */
const finish: Section = ({ s, top }) => ({
  segments: [
    lane("yellow", top, s + 6),
    at("kaykit_signage_finish_wide", 0, top, s + 8, { scale: 1.25 }),
    deck("blue", 0, top, s + 21, 3),
    ...flagRing(top, 0, s + 21, 7),
    ...sideRail("blue", -8.8, top, s + 15, s + 29),
    ...sideRail("blue", 8.8, top, s + 15, s + 29),
    ...crossRail("yellow", top, s + 29.2, -7, 7),
  ],
  length: 30,
});

/** Every section in running order. */
const SECTIONS = [
  ["startPlaza", startPlaza],
  ["spinGates", spinGates],
  ["carousels", carousels],
  ["checkpoint1", checkpointStop(1)],
  ["forkOne", forkOne],
  ["checkpoint2", checkpointStop(2, "blue")],
  ["turntables", turntables],
  ["hammerBridge", hammerBridge],
  ["checkpoint3", checkpointStop(3)],
  ["forkTwo", forkTwo],
  ["checkpoint4", checkpointStop(4, "yellow")],
  ["sweeperGauntlet", sweeperGauntlet],
  ["checkpoint5", checkpointStop(5)],
  ["theAscent", theAscent],
  ["checkpoint6", checkpointStop(6, "red")],
  ["forkThree", forkThree],
  ["checkpoint7", checkpointStop(7)],
  ["finalCarousel", finalCarousel],
  ["finish", finish],
] as const;

export type SpinCycleSectionName = (typeof SECTIONS)[number][0];

const laidOut = layOut<SpinCycleSectionName>(SECTIONS, { s: 0, top: 4 });

export const SPIN_CYCLE_TRACK: Track = laidOut.segments;
/** Where each section begins — `s` along the course and the deck `top` it starts from. The walk test steers by these. */
export const SPIN_CYCLE_SECTION_STARTS: Readonly<Record<SpinCycleSectionName, Readonly<Cursor>>> = laidOut.starts;
