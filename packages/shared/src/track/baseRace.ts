import { ASSET_PLACEMENT_MODULES } from "./assetModules.js";
import type { SegmentMotion } from "./Motion.js";
import type { Segment, Track } from "./Track.js";

/**
 * The base race (ADR 0078): the one code-owned seed Track, a Fall Guys-style
 * obstacle race built from Assets only. The API syncs it on boot under
 * {@link BASE_RACE_TRACK_ID}; every other Track is authored in the builder.
 *
 * Authored here as data rather than in the builder so the seed stays
 * reviewable and testable — `baseRace.test.ts` resolves it against the real
 * files and walks it end to end.
 *
 * Layout convention: the course runs straight along −Z from the Start. A
 * placement names `s`, the distance forward from the Start's back edge
 * (world z = −s), `x` across the lane (+ is right), and the height of the
 * deck top it stands on. Each section is laid out from the point the last
 * one ended, so a section can grow or shrink without re-measuring the rest.
 * Big decks are `platform_6x6x1` at scale 2 — a 12 m lane, 2 m thick.
 */
export const BASE_RACE_TRACK_ID = "base-race";
export const BASE_RACE_NAME = "Base Race";
/**
 * Five minutes on the clock: a straight walk with nothing moving takes about
 * two and a half, a real run with waiting and falls well over three.
 */
export const BASE_RACE_TIME_LIMIT_MS = 5 * 60_000;
/**
 * The seed's own Thumbnail, served from the assets directory beside the GLBs
 * (ADR 0085): a framed screenshot of this Track, shipped with the code that
 * owns it so the Round loader has art for the base race without anyone
 * republishing it from the builder.
 */
export const BASE_RACE_THUMBNAIL_FILE = "base_race.jpg";

type Color = "blue" | "green" | "red" | "yellow";
type Extra = Omit<Partial<Segment>, "moduleId" | "position">;

const at = (moduleId: string, x: number, y: number, s: number, extra: Extra = {}): Segment => {
  if (!ASSET_PLACEMENT_MODULES[moduleId]) throw new Error(`base race: unknown Asset "${moduleId}"`);
  return { moduleId, position: { x, y, z: -s }, rotation: 0, ...extra };
};

/** How far above its origin `moduleId`'s footprint tops out, at `scale`. */
const heightOf = (moduleId: string, scale: number): number => {
  const { center, halfExtents } = ASSET_PLACEMENT_MODULES[moduleId]!.footprint.bounds;
  return (center.y + halfExtents.y) * scale;
};

/** A level piece whose top lands at `top`. */
const onTop = (moduleId: string, x: number, top: number, s: number, extra: Extra = {}): Segment =>
  at(moduleId, x, top - heightOf(moduleId, extra.scale ?? 1), s, extra);

const LANE_SCALE = 2;
const LANE = 6 * LANE_SCALE;
const lane = (color: Color, top: number, s: number, extra: Extra = {}): Segment =>
  onTop(`kaykit_platform_6x6x1_${color}`, 0, top, s, { scale: LANE_SCALE, ...extra });

/** A spin about the piece's own vertical axis. */
const spin = (speed: number, startAngle = 0): SegmentMotion => ({
  spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed, ...(startAngle === 0 ? {} : { startAngle }) },
});

/**
 * A slide by `offset` in world metres — the Motion lives in the Segment's
 * scaled frame (ADR 0062), so the local offset is divided back out.
 */
const slide = (offset: { x: number; s: number }, scale: number, period: number, phase = 0): SegmentMotion => ({
  slide: {
    offset: { x: offset.x / scale, y: 0, z: (0 - offset.s) / scale }, // never −0: it would not survive a JSON round trip
    period,
    easing: "easeInOut",
    pause: 0.4,
    ...(phase === 0 ? {} : { phase }),
  },
});

/**
 * A gantry over the lane: two pillars and a beam whose underside is at
 * `beamBottom` — what a hanging obstacle visibly hangs from.
 */
const gantry = (color: Color, beamBottom: number, s: number): Segment[] => {
  const pillarScale = 1.5; // 2.4 wide, 12 tall
  const pillarHeight = heightOf("kaykit_pillar_2x2x8", pillarScale);
  return [
    at("kaykit_pillar_2x2x8", -8.5, beamBottom - pillarHeight, s, { scale: pillarScale }),
    at("kaykit_pillar_2x2x8", 8.5, beamBottom - pillarHeight, s, { scale: pillarScale }),
    at(`kaykit_platform_6x2x1_${color}`, 0, beamBottom, s, { scale: 3 }), // 18 wide, 3 tall
  ];
};

/** Where a section begins: `s` along the course, `top` the deck height it starts from. */
interface Cursor {
  s: number;
  top: number;
}
/** A laid-out section: its pieces, how far it runs along the course, and how much higher it ends. */
interface Laid {
  segments: Segment[];
  length: number;
  rise?: number;
}
type Section = (from: Cursor) => Laid;

// ---------------------------------------------------------------------------
// The sections, in running order.
// ---------------------------------------------------------------------------

/** The Start: a wide blue plaza, flags at its corners, a runway out. */
const startPlaza: Section = ({ s, top }) => ({
  segments: [
    onTop("kaykit_platform_6x6x1_blue", 0, top, s + 9, { scale: 3, start: true }),
    at("kaykit_flag_C_red", -8, top, s + 1, { scale: 1.5 }),
    at("kaykit_flag_C_yellow", 8, top, s + 1, { scale: 1.5 }),
    at("kaykit_flag_C_green", -8, top, s + 17, { scale: 1.5 }),
    at("kaykit_flag_C_blue", 8, top, s + 17, { scale: 1.5 }),
    lane("yellow", top, s + 24),
  ],
  length: 30,
});

/**
 * Door rush: three rows of tall walls across the lane, each with two 2 m
 * doors in different places — the whole lobby funnels through them at once.
 * Each wall is a 2 m block, so a row is six slots at x = −5 … 5; `doors`
 * names the open ones.
 */
export const DOOR_RUSH_SLOTS = [-5, -3, -1, 1, 3, 5];
export const DOOR_RUSH_ROWS: { ds: number; doors: number[] }[] = [
  { ds: 7, doors: [-3, 3] },
  { ds: 19, doors: [-5, 1] },
  { ds: 31, doors: [-1, 5] },
];
const doorRush: Section = ({ s, top }) => {
  const colors: Color[] = ["red", "blue", "green", "yellow"];
  const walls = DOOR_RUSH_ROWS.flatMap(({ ds, doors }, row) =>
    DOOR_RUSH_SLOTS.filter((x) => !doors.includes(x)).map((x, i) =>
      at(`kaykit_barrier_2x1x4_${colors[(row + i) % colors.length]}`, x, top, s + ds),
    ),
  );
  return {
    segments: [lane("blue", top, s + 6), lane("yellow", top, s + 18), lane("blue", top, s + 30), ...walls],
    length: 36,
  };
};

/**
 * Sweepers: four decks, each with two bars spinning about their middles —
 * staggered along the lane so the circles cover its centre line without the
 * bars ever meeting. Low enough to jump; each deck faster.
 */
export const SWEEPER_STAGGER = 2.8;
export const SWEEPER_SPEEDS = [1.5, 1.9, 2.3, 2.7];
const sweepers: Section = ({ s, top }) => {
  const BAR = "kaykit_barrier_4x1x1";
  const barScale = 1.8; // 7.2 m long, 1.8 m tall
  return {
    segments: SWEEPER_SPEEDS.flatMap((speed, i) => {
      const c = s + LANE / 2 + i * LANE;
      const barColor: Color = i % 2 === 0 ? "blue" : "green";
      return [
        lane(i % 2 === 0 ? "red" : "yellow", top, c),
        at(`${BAR}_${barColor}`, -3, top + 0.02, c - SWEEPER_STAGGER, { scale: barScale, motion: spin(speed) }),
        at(`${BAR}_${barColor}`, 3, top + 0.02, c + SWEEPER_STAGGER, { scale: barScale, motion: spin(-speed, Math.PI / 2) }),
      ];
    }),
    length: SWEEPER_SPEEDS.length * LANE,
  };
};

/**
 * A Checkpoint stop: a still green deck and an arch spanning the lane 8 m in,
 * switched on as Checkpoint `order` — its Respawn lands on the deck in front.
 */
const checkpointStop =
  (order: number): Section =>
  ({ s, top }) => ({
    segments: [lane("green", top, s + LANE / 2), at("kaykit_arch_wide_yellow", 0, top, s + 8, { scale: LANE_SCALE, checkpoint: { order } })],
    length: LANE,
  });

/**
 * The wrecking-ball bridge: a 6 m bridge under four balls swinging across it
 * in a wave, each hung from a gantry.
 */
export const WRECKING_BALL_DS = [8, 18, 28, 38];
const wreckingBalls: Section = ({ s, top }) => {
  const bridge = Array.from({ length: 8 }, (_, i) =>
    onTop(`kaykit_platform_4x4x1_${i % 2 === 0 ? "blue" : "green"}`, 0, top, s + 3 + i * 6, { scale: 1.5 }),
  );
  const CHAIN_TOP = 7.52; // trap_trapball's own attachment point, measured
  const restClearance = 0.25;
  const balls = WRECKING_BALL_DS.flatMap((ds, i) => [
    at("trap_trapball", 0, top + restClearance, s + ds, {
      motion: {
        swing: {
          axis: { x: 0, y: 0, z: 1 },
          pivot: { x: 0, y: CHAIN_TOP, z: 0 },
          amplitude: 0.95,
          period: 3.4,
          easing: "easeInOut",
          ...(i === 0 ? {} : { phase: (i * 0.27) % 1 }),
        },
      },
    }),
    ...gantry("red", top + restClearance + CHAIN_TOP, s + ds),
  ]);
  return { segments: [...bridge, ...balls], length: 48 };
};

/**
 * Moving platforms over the void: sliding rows carry you across the lane,
 * still rows between them are the breather, one row slides along the lane
 * (stretching and closing its gaps), and a narrow beam asks for balance.
 * `gap` is the open air before each row, `depth` × `width` its size along
 * and across the lane, and `x` where it rests across the lane.
 */
export const MOVING_ROWS: { gap: number; depth: number; width: number; x: number; piece: (x: number, top: number, s: number) => Segment }[] =
  (() => {
    const big = 1.5; // 6 × 6
    const row =
      (color: Color, scale: number, motion?: SegmentMotion) =>
      (x: number, top: number, s: number): Segment =>
        onTop(`kaykit_platform_4x4x1_${color}`, x, top, s, { scale, ...(motion ? { motion } : {}) });
    return [
      { gap: 2, depth: 6, width: 6, x: -4, piece: row("yellow", big, slide({ x: 8, s: 0 }, big, 4)) },
      { gap: 2, depth: 6, width: 6, x: 0, piece: row("red", big) },
      { gap: 2, depth: 6, width: 6, x: 4, piece: row("yellow", big, slide({ x: -8, s: 0 }, big, 3.6, 0.3)) },
      { gap: 2, depth: 4, width: 4, x: 1, piece: row("red", 1) },
      { gap: 1.5, depth: 6, width: 6, x: 0, piece: row("yellow", big, slide({ x: 0, s: 3 }, big, 3.2)) },
      { gap: 3.5, depth: 6, width: 6, x: 0, piece: row("red", big) },
      { gap: 2, depth: 6, width: 6, x: -2, piece: row("yellow", big, slide({ x: 6, s: 0 }, big, 3.4, 0.6)) },
      // A 2 m balance beam: the 6 × 2 piece turned to run along the lane.
      { gap: 2, depth: 6, width: 2, x: 0, piece: (x, top, s) => onTop("kaykit_platform_6x2x1_red", x, top, s, { rotation: Math.PI / 2 }) },
      { gap: 2, depth: 6, width: 6, x: 2, piece: row("yellow", big, slide({ x: -6, s: 0 }, big, 3, 0.15)) },
    ];
  })();
/** The open air after the last moving row, before the next still deck. */
const MOVING_LANDING_GAP = 2;
const movingPlatforms: Section = ({ s, top }) => {
  let edge = s;
  const segments = MOVING_ROWS.map(({ gap, depth, x, piece }) => {
    const center = edge + gap + depth / 2;
    edge = center + depth / 2;
    return piece(x, top, center);
  });
  return { segments, length: edge - s + MOVING_LANDING_GAP };
};

/**
 * Spinning squares: three 9 m decks turned 45° so their corners point along
 * the lane — corners line up every quarter turn — each with a bar spinning
 * the other way. The middle bar is spiked.
 */
export const SPINNING_SQUARE_DS = [7.5, 22.5, 37.5];
const spinningSquares: Section = ({ s, top }) => {
  const scale = 1.5; // 9 × 9
  const discs: { color: Color; speed: number; bar: string; barScale: number; barSpeed: number }[] = [
    { color: "blue", speed: 0.55, bar: "kaykit_barrier_4x1x1_yellow", barScale: 1.5, barSpeed: -1.4 },
    { color: "green", speed: -0.55, bar: "trap_trapcirclespikedoubleblue", barScale: 2, barSpeed: 1.6 },
    { color: "red", speed: 0.55, bar: "kaykit_barrier_4x1x1_yellow", barScale: 1.5, barSpeed: -1.8 },
  ];
  return {
    segments: discs.flatMap(({ color, speed, bar, barScale, barSpeed }, i) => {
      const c = s + SPINNING_SQUARE_DS[i]!;
      return [
        onTop(`kaykit_platform_6x6x1_${color}`, 0, top, c, { scale, rotation: Math.PI / 4, motion: spin(speed) }),
        at(bar, 0, top + 0.02, c, { scale: barScale, motion: spin(barSpeed) }),
      ];
    }),
    length: 45,
  };
};

/**
 * The climb: springs throw you onto a 6 m wall; on top, fans (or one more
 * spring) lift you another 6 m, where Checkpoint `order` waits.
 *
 * Pads are sunk into the deck until their tops sit 2 cm proud of it — there
 * is no autostep, so a pad you had to jump onto would be a wall — and a
 * standing capsule is still inside a flush pad's trigger. Fans are sunk a
 * metre so their air starts low: jump beside one and it carries you up.
 */
export const CLIMB_STEP = 6;
export const CLIMB_PAD_DS = 9.5;
export const CLIMB_FAN_DS = 29;
const climb =
  (order: number): Section =>
  ({ s, top }) => {
    const PAD = "kaykit_spring_pad_yellow";
    const padScale = 1.5;
    const launch = { height: 9 };
    const pad = (x: number, deckTop: number, ds: number): Segment =>
      at(PAD, x, deckTop + 0.02 - heightOf(PAD, padScale), s + ds, { scale: padScale, launch });
    const block = "kaykit_platform_6x6x4";
    const blockScale = 1.5; // 9 × 6 × 9
    const tierB = top + CLIMB_STEP;
    const tierC = tierB + CLIMB_STEP;
    return {
      segments: [
        lane("red", top, s + 6),
        ...[-4, 0, 4].map((x) => pad(x, top, CLIMB_PAD_DS)),
        at(`${block}_blue`, 0, top, s + 16.5, { scale: blockScale }),
        lane("blue", tierB, s + 27),
        at("fan", -3.5, tierB - 1, s + CLIMB_FAN_DS, { scale: 1.5 }),
        at("fan", 3.5, tierB - 1, s + CLIMB_FAN_DS, { scale: 1.5 }),
        pad(0, tierB, CLIMB_FAN_DS),
        at(`${block}_red`, 0, tierB, s + 37.5, { scale: blockScale }),
        lane("green", tierC, s + 48),
        at("kaykit_arch_wide_yellow", 0, tierC, s + 46, { scale: LANE_SCALE, checkpoint: { order } }),
      ],
      length: 54,
      rise: 2 * CLIMB_STEP,
    };
  };

/**
 * A pitched lane deck whose top centre is at (`topS`, `topH`) — the origin
 * sits the deck's thickness below the top, along the tilted up axis.
 */
const pitchedLane = (color: Color, topS: number, topH: number, pitch: number, extra: Extra = {}): Segment => {
  const thickness = heightOf(`kaykit_platform_6x6x1_${color}`, LANE_SCALE);
  // Local up (0, t, 0) pitched is (0, t·cos, t·sin) in world — +z is back down the lane.
  return at(`kaykit_platform_6x6x1_${color}`, 0, topH - thickness * Math.cos(pitch), topS + thickness * Math.sin(pitch), {
    scale: LANE_SCALE,
    pitch,
    ...extra,
  });
};

/** A piece standing `along` metres up a pitched deck from its top centre, pitched with it. */
const onSlope = (moduleId: string, x: number, topS: number, topH: number, pitch: number, along: number, extra: Extra = {}): Segment =>
  at(moduleId, x, topH + along * Math.sin(pitch), topS + along * Math.cos(pitch), { pitch, ...extra });

/**
 * The belt climb: five decks pitched up the lane with belts running against
 * you, and pusher walls sliding across the second and fourth.
 */
export const BELT_PITCH = 0.16;
export const BELT_PUSHER_ALONG = 2.5;
const beltClimb: Section = ({ s, top }) => {
  const step = { s: LANE * Math.cos(BELT_PITCH), h: LANE * Math.sin(BELT_PITCH) };
  const presets = ["slow", "slow", "medium", "slow", "medium"] as const;
  const WALL = "kaykit_barrier_4x1x2_blue";
  const wallScale = 1.2; // 4.8 wide, 2.4 tall
  return {
    segments: presets.flatMap((preset, i) => {
      const topS = s + (i + 0.5) * step.s;
      const topH = top + (i + 0.5) * step.h;
      const deck = pitchedLane(i % 2 === 0 ? "yellow" : "red", topS, topH, BELT_PITCH, { conveyor: { preset, angle: Math.PI } });
      if (i % 2 === 0) return [deck];
      return [
        deck,
        onSlope(WALL, -3.6, topS, topH, BELT_PITCH, -BELT_PUSHER_ALONG, { scale: wallScale, motion: slide({ x: 7.2, s: 0 }, wallScale, 3.2) }),
        onSlope(WALL, 3.6, topS, topH, BELT_PITCH, BELT_PUSHER_ALONG, { scale: wallScale, motion: slide({ x: -7.2, s: 0 }, wallScale, 3.2, 0.5) }),
      ];
    }),
    length: presets.length * step.s,
    rise: presets.length * step.h,
  };
};

/**
 * The ice slide: three icy decks tilt back down with bumpers in the way. You
 * pick up speed; the edges don't forgive. Each bumper is (x, metres along
 * its deck from the deck's top centre).
 */
export const ICE_PITCH = -0.14;
export const ICE_BUMPERS: [number, number][][] = [
  [
    [-2.5, -1.5],
    [3.5, 3],
  ],
  [
    [2, -1.5],
    [-4, 3],
  ],
  [[-1, -1.5]],
];
const iceSlide: Section = ({ s, top }) => {
  const step = { s: LANE * Math.cos(ICE_PITCH), h: LANE * Math.sin(ICE_PITCH) };
  return {
    segments: ICE_BUMPERS.flatMap((bumpers, i) => {
      const topS = s + (i + 0.5) * step.s;
      const topH = top + (i + 0.5) * step.h;
      return [
        pitchedLane("blue", topS, topH, ICE_PITCH, { ice: true }),
        ...bumpers.map(([x, along]) => onSlope("kaykit_ball_red", x, topS, topH, ICE_PITCH, along)),
      ];
    }),
    length: ICE_BUMPERS.length * step.s,
    rise: ICE_BUMPERS.length * step.h,
  };
};

/**
 * Hammer alley: pendulum hammers hung across the lane from gantries.
 * `trap_hammerbig` lies along its own Z with the head at −Z and its hub at
 * (0, 1.25, 1.65); pitched −90° it hangs head-down from the hub, and a
 * quarter-turn yaw swings it across the lane about the hub's axle.
 */
export const HAMMER_DS = [6, 17, 28, 39, 50];
const hammerAlley: Section = ({ s, top }) => {
  const HAMMER = "trap_hammerbig";
  const hub = { x: 0, y: 1.25, z: 1.65 };
  const reach = 2.95; // the head's lowest point below the origin once hung
  const scale = 1.5;
  const decks = HAMMER_DS.map((_, i) => lane(i % 2 === 0 ? "green" : "yellow", top, s + LANE / 2 + i * LANE));
  const hammers = HAMMER_DS.flatMap((ds, i) => {
    const originY = top + 0.35 + reach * scale;
    const hubY = originY + hub.z * scale;
    return [
      // Hung, the hub lands hub.z·scale above the origin and hub.y·scale to its −X — shifted back onto the lane's centre.
      at(HAMMER, hub.y * scale, originY, s + ds, {
        rotation: Math.PI / 2,
        pitch: -Math.PI / 2,
        scale,
        motion: {
          swing: {
            axis: { x: 1, y: 0, z: 0 },
            pivot: hub,
            amplitude: 1.05,
            period: 2.6 + (i % 3) * 0.3,
            easing: "easeInOut",
            ...(i === 0 ? {} : { phase: (i * 0.37) % 1 }),
          },
        },
      }),
      ...gantry("blue", hubY + 1.3 * scale, s + ds),
    ];
  });
  return { segments: [...decks, ...hammers], length: HAMMER_DS.length * LANE };
};

/** The finish: a last deck and the wide finish sign across it. */
const finish: Section = ({ s, top }) => ({
  segments: [lane("blue", top, s + LANE / 2), at("kaykit_signage_finish_wide", 0, top, s + 8, { scale: 1.25 })],
  length: LANE,
});

/** Every section in running order. */
const SECTIONS = [
  ["startPlaza", startPlaza],
  ["doorRush", doorRush],
  ["sweepers", sweepers],
  ["checkpoint1", checkpointStop(1)],
  ["wreckingBalls", wreckingBalls],
  ["checkpoint2", checkpointStop(2)],
  ["movingPlatforms", movingPlatforms],
  ["checkpoint3", checkpointStop(3)],
  ["spinningSquares", spinningSquares],
  ["checkpoint4", checkpointStop(4)],
  ["climb", climb(5)],
  ["beltClimb", beltClimb],
  ["checkpoint6", checkpointStop(6)],
  ["iceSlide", iceSlide],
  ["checkpoint7", checkpointStop(7)],
  ["hammerAlley", hammerAlley],
  ["finish", finish],
] as const;

export type BaseRaceSectionName = (typeof SECTIONS)[number][0];

const layOut = (): { track: Track; starts: Record<BaseRaceSectionName, Cursor> } => {
  const cursor: Cursor = { s: 0, top: 4 };
  const track: Track = [];
  const starts = {} as Record<BaseRaceSectionName, Cursor>;
  for (const [name, section] of SECTIONS) {
    starts[name] = { ...cursor };
    const laid = section(cursor);
    track.push(...laid.segments);
    cursor.s += laid.length;
    cursor.top += laid.rise ?? 0;
  }
  return { track, starts };
};

const laidOut = layOut();

export const BASE_RACE_TRACK: Track = laidOut.track;
/** Where each section begins — `s` along the course and the deck `top` it starts from. The walk test steers by these. */
export const BASE_RACE_SECTION_STARTS: Readonly<Record<BaseRaceSectionName, Readonly<Cursor>>> = laidOut.starts;
