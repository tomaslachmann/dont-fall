import {
  at,
  chainCentres,
  crossRail,
  flushOn,
  gantry,
  hangingHammer,
  heightOf,
  layOut,
  onPitched,
  onTop,
  pitchedDeck,
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
 * SLIP STREAM — a Race Track about what the floor does to you. Belts that
 * carry you (and belts that carry you back), ice with no grip, mud with no
 * pace, inflatable decks that throw you on, Springs that throw you up and
 * fans that hold you in the air. Three forks, and at each one the fast arm is
 * the one that can lose you.
 *
 * The companion to `spinCycle.ts`, which is about things that turn; this one
 * is about Surfaces. Published to a running API by `pnpm publish:tracks` —
 * content, not the boot seed (ADR 0078).
 *
 * Layout convention and the rest-pose rule are `authoring.ts`'s: the course
 * runs along −Z, and with every Motion stopped the course is still walkable.
 * Conveyors, ice, mud and bounce are *not* Motions — they are always on, so
 * the walk check runs over them exactly as a Player does.
 */
export const SLIP_STREAM_TRACK_ID = "slip-stream";
export const SLIP_STREAM_NAME = "Slip Stream";
/** Six minutes, like Spin Cycle: a straight walk with nothing moving is about three. */
export const SLIP_STREAM_TIME_LIMIT_MS = 6 * 60_000;
export const SLIP_STREAM_ENVIRONMENT = "sunset" as const;

const LANE_SCALE = 2;
export const LANE = 6 * LANE_SCALE;

const lane = (color: TrackColor, top: number, s: number, extra: Extra = {}): Segment =>
  onTop(`kaykit_platform_6x6x1_${color}`, 0, top, s, { scale: LANE_SCALE, ...extra });

const deck = (color: TrackColor, x: number, top: number, s: number, scale: number, extra: Extra = {}): Segment =>
  onTop(`kaykit_platform_6x6x1_${color}`, x, top, s, { scale, ...extra });

/** A bar turning flat over a deck, its axle pushed off centre so a strip of the deck stays open at rest. */
const sweeper = (
  color: TrackColor,
  x: number,
  deckTop: number,
  s: number,
  { scale, speed, startAngle = 0 }: { scale: number; speed: number; startAngle?: number },
): Segment => at(`kaykit_barrier_4x1x1_${color}`, x, deckTop + 0.02, s, { scale, motion: spin(speed, startAngle) });

/**
 * A Spring pad sunk until its top is 2 cm proud of the deck. There is no
 * autostep, so a pad you had to jump onto would be a wall — and a standing
 * capsule is still inside a flush pad's trigger.
 */
const springPad = (color: TrackColor, x: number, deckTop: number, s: number, height: number, scale = 1.5): Segment =>
  flushOn(`kaykit_spring_pad_${color}`, x, deckTop, s, { scale, launch: { height } });

/**
 * A fan sunk a metre into its deck, so its air starts low: jump beside one
 * and it carries you up. The Volume its def owns reaches about ten metres
 * above the deck at this size.
 */
const fanColumn = (x: number, deckTop: number, s: number, scale = 1.5): Segment => at("fan", x, deckTop - 1, s, { scale });

/** A column dropping out of sight under a floating deck — drawn, never landed on. */
const underPillar = (x: number, deckBottom: number, s: number, scale = 1.5): Segment =>
  at("kaykit_pillar_2x2x8", x, deckBottom - 0.1 - heightOf("kaykit_pillar_2x2x8", scale), s, { scale });

/** A fork's signage, hung clear of the route — a sign standing on the deck is a wall. */
const signpost = (moduleId: string, x: number, top: number, s: number): Segment =>
  at(moduleId, x, top + 2.6, s, { rotation: Math.PI });

// ---------------------------------------------------------------------------
// The sections, in running order.
// ---------------------------------------------------------------------------

/** The Start: a fenced yard, flags at the corners, and the first belt already visible from it. */
const startYard: Section = ({ s, top }) => ({
  segments: [
    deck("red", 0, top, s + 9, 3, { start: true }),
    at("kaykit_flag_C_yellow", -7, top, s + 2, { scale: 1.5 }),
    at("kaykit_flag_C_blue", 7, top, s + 2, { scale: 1.5 }),
    at("kaykit_flag_C_green", -7, top, s + 16, { scale: 1.5 }),
    at("kaykit_flag_C_red", 7, top, s + 16, { scale: 1.5 }),
    ...[2, 6, 10, 14, 18].flatMap((ds) => [
      at("trap_fencebig", -8.6, top, s + ds, { rotation: Math.PI / 2 }),
      at("trap_fencebig", 8.6, top, s + ds, { rotation: Math.PI / 2 }),
    ]),
    ...crossRail("red", top, s + 0.8, -7, 7, "padded"),
    at("kaykit_cone_yellow", -3, top, s + 21, { prop: true }),
    at("kaykit_cone_yellow", 3, top, s + 21, { prop: true }),
    lane("blue", top, s + 24),
  ],
  length: 30,
});

/**
 * Cross belts: four decks whose floors are all going somewhere. The first
 * runs with you and is the fastest ground on the Track; the second and fourth
 * run across it, toward the edge, with a wall parked where you would like to
 * stand; the third runs against you.
 */
const CROSS_BELT_DS = [6, 18, 30, 42];
const crossBelts: Section = ({ s, top }) => {
  // `wallX` is stated rather than derived from the angle: the wall's job is to
  // take away the half of the deck a Player would rather stand on, and which
  // half that is depends on the belt's direction, not on its sign.
  const belts = [
    { preset: "fast", angle: 0, wallX: -3.5 },
    { preset: "slow", angle: Math.PI / 2, wallX: 3.5 },
    { preset: "medium", angle: Math.PI, wallX: 3.5 },
    { preset: "slow", angle: -Math.PI / 2, wallX: -3.5 },
  ] as const;
  return {
    segments: [
      ...CROSS_BELT_DS.flatMap((ds, i) => {
        const belt = belts[i]!;
        return [
          lane(i % 2 === 0 ? "yellow" : "green", top, s + ds, { conveyor: { preset: belt.preset, angle: belt.angle } }),
          at(`kaykit_barrier_3x1x2_${i % 2 === 0 ? "red" : "blue"}`, belt.wallX, top, s + ds, { scale: 1.5 }),
        ];
      }),
      ...[6, 18, 30, 42].flatMap((ds) => [underPillar(0, top - 2, s + ds, 2)]),
    ],
    length: 48,
  };
};

/** How far each of the Spring climb's two steps lifts the course. */
const SPRING_STEP = 6;
export const SPRING_PAD_DS = 9.5;
export const SPRING_FAN_DS = 29;
/**
 * The Spring climb: three pads throw you onto a six-metre block, and on top
 * of it two fans and one more pad lift you another six. Lifted straight from
 * the base race's own climb, which is the one shape in this game already
 * proven to get a Player up a wall without a ladder.
 */
const springSteps: Section = ({ s, top }) => {
  const block = "kaykit_platform_6x6x4";
  const blockScale = 1.5; // 9 across, 6 tall, 9 deep
  const tierB = top + SPRING_STEP;
  const tierC = tierB + SPRING_STEP;
  return {
    segments: [
      lane("red", top, s + 6),
      ...[-4, 0, 4].map((x) => springPad("yellow", x, top, s + SPRING_PAD_DS, 9)),
      at(`${block}_green`, 0, top, s + 16.5, { scale: blockScale }),
      lane("yellow", tierB, s + 27),
      fanColumn(-3.5, tierB, s + SPRING_FAN_DS),
      fanColumn(3.5, tierB, s + SPRING_FAN_DS),
      springPad("red", 0, tierB, s + SPRING_FAN_DS, 9),
      at(`${block}_blue`, 0, tierB, s + 37.5, { scale: blockScale }),
      lane("green", tierC, s + 48),
      ...sideRail("green", -5.6, tierC, s + 43, s + 53),
      ...sideRail("green", 5.6, tierC, s + 43, s + 53),
    ],
    length: 54,
    rise: 2 * SPRING_STEP,
  };
};

/** A Checkpoint stop: a still deck and an arch across it. */
const checkpointStop =
  (order: number, color: TrackColor = "blue"): Section =>
  ({ s, top }) => ({
    segments: [
      lane(color, top, s + LANE / 2),
      at("kaykit_arch_wide_red", 0, top, s + 8, { scale: LANE_SCALE, checkpoint: { order } }),
      at("kaykit_flag_A_yellow", -5, top, s + 3, { scale: 1.2 }),
      at("kaykit_flag_A_green", 5, top, s + 3, { scale: 1.2 }),
    ],
    length: LANE,
  });

/** A hung obstacle and the gantry it hangs from. */
const hungFrom = (color: TrackColor, x: number, { segment, hubY }: { segment: Segment; hubY: number }, s: number, halfSpan = 8.5): Segment[] => [
  segment,
  ...gantry({ color, beamBottom: hubY + 1.3, s, x, halfSpan, beamScale: (halfSpan * 2) / 6 }),
];

export const FORK_ONE_ICE_X = -11;
export const FORK_ONE_LADDER_X = 10;
export const FORK_ONE_ICE_DS = [22.5, 31.5, 40.5, 49.5, 58.5, 67.5];
export const FORK_ONE_PAD_DS = 25.5;
const FORK_ONE_CATWALK_RISE = 6;
export const FORK_ONE_BAR_DS = [36, 48, 60, 72];
/**
 * The first fork. Left is the greasy mile: six decks of ice with bumpers
 * parked along both edges, so the thing that stops you leaving the Track is
 * also the thing that knocks you off your line. Right is the ladder: a Spring
 * throws you onto a catwalk six metres up, four bars sweep it, and it ends by
 * dropping you back down.
 */
const forkOne: Section = ({ s, top }) => {
  const catwalkTop = top + FORK_ONE_CATWALK_RISE;
  return {
    segments: [
      deck("green", 0, top, s + 9, 3),
      signpost("kaykit_signage_arrows_left_blue", -5, top, s + 14),
      signpost("kaykit_signage_arrows_right_red", 5, top, s + 14),
      ...FORK_ONE_ICE_DS.flatMap((ds, i) => [
        deck(i % 2 === 0 ? "blue" : "green", FORK_ONE_ICE_X, top, s + ds, 1.5, { ice: true }),
        // Props (ADR 0095): on ice the bumpers are the one thing you can push
        // back, and the one thing someone else can push into you.
        at(`kaykit_ball_${i % 2 === 0 ? "red" : "yellow"}`, FORK_ONE_ICE_X - 3, top, s + ds, { scale: 0.9, prop: true }),
        at(`kaykit_ball_${i % 2 === 0 ? "yellow" : "red"}`, FORK_ONE_ICE_X + 3, top, s + ds, { scale: 0.9, prop: true }),
      ]),
      deck("red", FORK_ONE_LADDER_X, top, s + 22.5, 1.5),
      springPad("yellow", FORK_ONE_LADDER_X, top, s + FORK_ONE_PAD_DS, 9),
      onTop("kaykit_platform_6x2x1_yellow", FORK_ONE_LADDER_X, catwalkTop, s + 42, { scale: 4, rotation: Math.PI / 2 }),
      onTop("kaykit_platform_6x2x1_red", FORK_ONE_LADDER_X, catwalkTop, s + 66, { scale: 4, rotation: Math.PI / 2 }),
      ...FORK_ONE_BAR_DS.map((ds, i) =>
        sweeper(i % 2 === 0 ? "blue" : "green", FORK_ONE_LADDER_X + (i % 2 === 0 ? 2.5 : -2.5), catwalkTop, s + ds, {
          scale: 1.6,
          speed: i % 2 === 0 ? -1.8 : 2,
          startAngle: Math.PI / 2,
        }),
      ),
      deck("yellow", 0, top, s + 84, 4),
    ],
    length: 96,
  };
};

export const BOUNCE_FIELD_DS = [6, 20, 34, 48];
/**
 * The bounce field: four inflatable lane decks with two metres of air between
 * them. Walk on and nothing happens; arrive off a jump and the deck gives it
 * back, which is either the next gap crossed or a Player leaving over the
 * side. Two of them also have a bar turning over the landing.
 */
const bounceField: Section = ({ s, top }) => ({
  segments: BOUNCE_FIELD_DS.flatMap((ds, i) => [
    lane(i % 2 === 0 ? "yellow" : "red", top, s + ds, { bounce: true }),
    ...(i % 2 === 0
      ? [sweeper("blue", i === 0 ? 2.5 : -2.5, top, s + ds + 3, { scale: 2, speed: i === 0 ? 1.5 : -1.7 })]
      : [
          at(`kaykit_barrier_4x1x2_${i === 1 ? "green" : "blue"}`, i === 1 ? -5 : 5, top, s + ds, {
            scale: 1.5,
            motion: slide({ offset: { x: i === 1 ? 10 : -10 }, scale: 1.5, period: 3.6, phase: i * 0.3 }),
          }),
        ]),
    underPillar(0, top - 2, s + ds, 2),
  ]),
  length: 54,
});

export const SLALOM_DS = [6, 18, 30, 42];
/**
 * The slalom: four decks with a wall sliding across each, parked on opposite
 * sides and staggered along the lane, so the way through is a zig-zag that
 * closes behind you. Two of them have a spiked wheel turning on the centre
 * line — every contact with one of those puts you down, whatever your speed.
 */
const slalom: Section = ({ s, top }) => ({
  segments: SLALOM_DS.flatMap((ds, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    return [
      lane(i % 2 === 0 ? "green" : "blue", top, s + ds),
      at(`kaykit_barrier_4x1x2_${i % 2 === 0 ? "red" : "yellow"}`, side * 5, top, s + ds - 3, {
        scale: 1.5,
        motion: slide({ offset: { x: -side * 10 }, scale: 1.5, period: 3.4, phase: i * 0.22 }),
      }),
      at(`kaykit_barrier_4x1x2_${i % 2 === 0 ? "yellow" : "red"}`, -side * 5, top, s + ds + 3, {
        scale: 1.5,
        motion: slide({ offset: { x: side * 10 }, scale: 1.5, period: 3.4, phase: i * 0.22 + 0.5 }),
      }),
      // Out by the edges, never on the centre line: the walls already force a
      // crossing through the middle of every deck, and a spiked wheel parked
      // in that crossing would be a wall of its own rather than a punishment
      // for taking it wide.
      ...(i % 2 === 1
        ? [-5, 5].map((x) => at("trap_trapcirclespikedoublered", x, top + 0.02, s + ds, { motion: spin(x < 0 ? 2.2 : -2.4) }))
        : []),
    ];
  }),
  length: 48,
});

export const FORK_TWO_ARM_X = [-15, 0, 15] as const;
/** Where the second fork's arms begin and end — every arm is laid between these two. */
const FORK_TWO_FROM = 15;
export const FORK_TWO_TO = 78.5;
export const FORK_TWO_UPDRAFT_DS = chainCentres(FORK_TWO_FROM, FORK_TWO_TO, 6, 9);
export const FORK_TWO_STONE_DS = chainCentres(FORK_TWO_FROM, FORK_TWO_TO, 6, 8);
// Six twelve-metre decks over sixty-three metres: they overlap slightly
// rather than leaving gaps, because "wide and continuous" is the whole
// trade this arm offers against the other two.
export const FORK_TWO_MUD_DS = chainCentres(FORK_TWO_FROM, FORK_TWO_TO, 6, 12);
/**
 * The second fork, three arms wide. Left is updraft alley: six decks with
 * fans sunk into them, so a jump taken beside one is held up long past where
 * it should have come down. The middle is stepping stones under hammers.
 * Right is the mudflat — wide, railed, and half speed the whole way.
 */
const forkTwo: Section = ({ s, top }) => {
  const [ax, bx, cx] = FORK_TWO_ARM_X;
  const row = (color: TrackColor, ds: number): Segment[] => FORK_TWO_ARM_X.map((x) => deck(color, x, top, s + ds, 2.5));
  return {
    segments: [
      ...row("red", 7.5),
      signpost("kaykit_signage_arrows_left_yellow", -9, top, s + 12),
      signpost("kaykit_signage_arrow_stand_blue", 0, top, s + 12),
      signpost("kaykit_signage_arrows_right_green", 9, top, s + 12),
      ...FORK_TWO_UPDRAFT_DS.flatMap((ds, i) => [
        deck(i % 2 === 0 ? "blue" : "yellow", ax, top, s + ds, 1.5),
        ...(i % 2 === 0 ? [fanColumn(ax - 3.5, top, s + ds), fanColumn(ax + 3.5, top, s + ds)] : []),
      ]),
      ...FORK_TWO_STONE_DS.flatMap((ds, i) => [
        onTop(`kaykit_platform_4x4x1_${i % 2 === 0 ? "green" : "red"}`, bx, top, s + ds, { scale: 2 }),
        ...(i % 2 === 1
          ? hungFrom("blue", bx, hangingHammer({ x: bx, deckTop: top, s: s + ds, period: 2.6 + i * 0.2, phase: (i * 0.33) % 1 }), s + ds, 6)
          : []),
      ]),
      ...FORK_TWO_MUD_DS.flatMap((ds, i) => [
        deck(i % 2 === 0 ? "red" : "green", cx, top, s + ds, 2, { mud: true }),
        ...sideRail("red", cx + 5.6, top, s + ds - 5, s + ds + 5),
      ]),
      // Seated so its near edge is exactly where every arm ends (FORK_TWO_TO),
      // and the section ends where the rejoin does.
      ...row("red", 86),
    ],
    length: 93.5,
  };
};

/** How steeply the ice river falls, and how many decks of it there are. */
export const ICE_RIVER_PITCH = -0.1;
const ICE_RIVER_DECKS = 5;
/** Each bumper on the river: how far across, and how far up its own deck from that deck's top centre. */
const ICE_RIVER_BUMPERS: readonly (readonly [number, number])[][] = [
  [
    [-4, -2],
    [4.5, 2],
  ],
  [
    [4, -2],
    [-4.5, 2],
  ],
  [
    [-4, -2],
    [4.5, 2],
  ],
  [
    [4, -2],
    [-4.5, 2],
  ],
  [
    [-4, 0],
    [4.5, 3],
  ],
];
/** The ice river: five decks tilted away from you, iced, with bumpers set in the fall line. You do not walk this so much as survive it. */
const iceRiver: Section = ({ s, top }) => {
  const step = { s: LANE * Math.cos(ICE_RIVER_PITCH), h: LANE * Math.sin(ICE_RIVER_PITCH) };
  return {
    segments: ICE_RIVER_BUMPERS.flatMap((bumpers, i) => {
      const topS = s + (i + 0.5) * step.s;
      const topH = top + (i + 0.5) * step.h;
      return [
        pitchedDeck(`kaykit_platform_6x6x1_${i % 2 === 0 ? "blue" : "green"}`, 0, topS, topH, ICE_RIVER_PITCH, {
          scale: LANE_SCALE,
          ice: true,
        }),
        ...bumpers.map(([x, along]) => onPitched("kaykit_ball_red", x!, topS, topH, ICE_RIVER_PITCH, along!)),
      ];
    }),
    length: ICE_RIVER_DECKS * step.s,
    rise: ICE_RIVER_DECKS * step.h,
  };
};

export const LAUNCH_GAP_DS = [4.5, 19.5, 34.5, 49.5];
/**
 * Launch gaps: four decks with six metres of air between them and a Spring
 * pad sunk into the far edge of each. There is no decision to make — cross
 * the pad and it fires — so the whole section is about how fast you were
 * going when it did.
 */
const launchGap: Section = ({ s, top }) => ({
  segments: LAUNCH_GAP_DS.flatMap((ds, i) => [
    deck(i % 2 === 0 ? "yellow" : "red", 0, top, s + ds, 1.5),
    ...(i < LAUNCH_GAP_DS.length - 1 ? [springPad("blue", 0, top, s + ds + 3, 7)] : []),
    underPillar(0, top - 1.5, s + ds, 1.5),
    at(`kaykit_flag_A_${i % 2 === 0 ? "blue" : "yellow"}`, -3.6, top, s + ds - 3, { scale: 1.2 }),
    at(`kaykit_flag_A_${i % 2 === 0 ? "yellow" : "blue"}`, 3.6, top, s + ds - 3, { scale: 1.2 }),
  ]),
  length: 54,
});

export const FORK_THREE_BELT_X = -10;
export const FORK_THREE_GAP_X = 10;
export const FORK_THREE_BELT_DS = chainCentres(18, 54, 4, 9);
export const FORK_THREE_GAP_DS = chainCentres(18, 54, 5, 6);
/**
 * The last fork. Left is a belt running the wrong way with two walls sliding
 * over it: nothing there can drop you, and none of it is quick. Right is five
 * stepping stones with real gaps and two bars turning on them.
 */
const forkThree: Section = ({ s, top }) => ({
  segments: [
    deck("blue", 0, top, s + 9, 3),
    signpost("kaykit_signage_arrows_left_green", -5, top, s + 14),
    signpost("kaykit_signage_arrows_right_yellow", 5, top, s + 14),
    ...FORK_THREE_BELT_DS.flatMap((ds, i) => [
      deck(i % 2 === 0 ? "red" : "yellow", FORK_THREE_BELT_X, top, s + ds, 1.5, {
        conveyor: { preset: i % 2 === 0 ? "slow" : "medium", angle: Math.PI },
      }),
      ...(i % 2 === 1
        ? [
            at("kaykit_barrier_2x1x2_blue", FORK_THREE_BELT_X + 3.5, top, s + ds, {
              scale: 1.5,
              motion: slide({ offset: { x: -7 }, scale: 1.5, period: 3.2, phase: i * 0.25 }),
            }),
          ]
        : []),
    ]),
    ...FORK_THREE_GAP_DS.flatMap((ds, i) => [
      onTop(`kaykit_platform_4x4x1_${i % 2 === 0 ? "green" : "blue"}`, FORK_THREE_GAP_X, top, s + ds, { scale: 1.5 }),
      ...(i === 1 || i === 3
        ? [sweeper("red", FORK_THREE_GAP_X + 1.6, top, s + ds, { scale: 1.1, speed: i === 1 ? 2.1 : -2.3, startAngle: Math.PI / 2 })]
        : []),
    ]),
    deck("green", 0, top, s + 66, 4),
  ],
  length: 78,
});

export const FINAL_RUN_DS = [6, 18, 30, 42, 54];
/** The last straight: a belt running back at you the whole way, under four wrecking balls. */
const finalRun: Section = ({ s, top }) => ({
  segments: FINAL_RUN_DS.flatMap((ds, i) => [
    lane(i % 2 === 0 ? "red" : "yellow", top, s + ds, { conveyor: { preset: "slow", angle: Math.PI } }),
    ...(i < 4
      ? hungFrom("blue", 0, wreckingBall({ x: 0, deckTop: top, s: s + ds + 6, period: 3.2 + (i % 2) * 0.4, phase: (i * 0.31) % 1 }), s + ds + 6)
      : []),
  ]),
  length: 60,
});

/** The finish: the wide sign over a last lane, and a plaza to stop on. */
const finish: Section = ({ s, top }) => ({
  segments: [
    lane("green", top, s + 6),
    at("kaykit_signage_finish_wide", 0, top, s + 8, { scale: 1.25 }),
    deck("red", 0, top, s + 21, 3),
    at("kaykit_flag_C_yellow", -7, top, s + 15, { scale: 1.5 }),
    at("kaykit_flag_C_blue", 7, top, s + 15, { scale: 1.5 }),
    at("kaykit_flag_C_green", -7, top, s + 27, { scale: 1.5 }),
    at("kaykit_flag_C_red", 7, top, s + 27, { scale: 1.5 }),
    ...sideRail("red", -8.8, top, s + 15, s + 29, "padded"),
    ...sideRail("red", 8.8, top, s + 15, s + 29, "padded"),
    ...crossRail("yellow", top, s + 29.2, -7, 7, "padded"),
  ],
  length: 30,
});

/** Every section in running order. */
const SECTIONS = [
  ["startYard", startYard],
  ["crossBelts", crossBelts],
  ["springSteps", springSteps],
  ["checkpoint1", checkpointStop(1)],
  ["forkOne", forkOne],
  ["checkpoint2", checkpointStop(2, "green")],
  ["bounceField", bounceField],
  ["slalom", slalom],
  ["checkpoint3", checkpointStop(3)],
  ["forkTwo", forkTwo],
  ["checkpoint4", checkpointStop(4, "yellow")],
  ["iceRiver", iceRiver],
  ["checkpoint5", checkpointStop(5)],
  ["launchGap", launchGap],
  ["forkThree", forkThree],
  ["checkpoint6", checkpointStop(6, "red")],
  ["finalRun", finalRun],
  ["checkpoint7", checkpointStop(7)],
  ["finish", finish],
] as const;

export type SlipStreamSectionName = (typeof SECTIONS)[number][0];

const laidOut = layOut<SlipStreamSectionName>(SECTIONS, { s: 0, top: 4 });

export const SLIP_STREAM_TRACK: Track = laidOut.segments;
/** Where each section begins — `s` along the course and the deck `top` it starts from. The walk check steers by these. */
export const SLIP_STREAM_SECTION_STARTS: Readonly<Record<SlipStreamSectionName, Readonly<Cursor>>> = laidOut.starts;
