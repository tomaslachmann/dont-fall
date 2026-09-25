// HAND-AUTHORED (ADR 0116), from `pnpm convert:df`'s printed measurements.
// The four DF traps — the first Assets built from more than one body. Like
// `fanAssetDefs.ts`, this file is written by hand and not generated: four
// files with four different mechanics are not a pack, and the numbers below
// are ones an author moves. The converter prints them; it never writes here.
import type { AssetModuleDef } from "./assetModules.js";

/**
 * How fast the sweeper's rotor turns, in radians per second, about its own
 * −Y. Read off the authored clip (a full turn in 5.04 s) and kept as the
 * placed Segment's default — a sweeper you drop into a Track sweeps without
 * being told to. The author's Motion overrides it (ADR 0116).
 */
export const SWEEPER_ROTOR_SPIN = 1.246;

/**
 * The three-arm sweeper's three rotors (ADR 0124), in radians per second
 * about +Y, each read off its own clip: the low arm a turn every 10 s one
 * way, the middle one twice as fast the other, the high one four times as
 * fast the first way again. Each placed Segment's defaults; the author
 * retunes each arm on its own (`Segment.partMotions`).
 */
export const SWEEPER_3ARMS_SPIN = { low: -Math.PI / 5, mid: (2 * Math.PI) / 5, high: (-4 * Math.PI) / 5 } as const;

/**
 * Where each rotor is at Tick 0, from its rest (radians about +Y). The
 * converter rests the arms at 0°, 180° and 0° so they balance about the
 * tower; these put them back where the clips start (15°, 140°, −100°), so
 * no two arms line up.
 */
const SWEEPER_3ARMS_START = { low: Math.PI / 12, mid: (-2 * Math.PI) / 9, high: (-5 * Math.PI) / 9 } as const;

/**
 * The trap door's authored swing (ADR 0117), lifted from its clip by
 * `pnpm convert:df` at the clip's own 24 fps: shut at 0, a small lift the
 * *other* way as it loads up — the tell a Player reads — then 88° down, held
 * open, and back. Replayed by `trapDoorAngle`; never re-modelled here, so
 * re-exporting the GLB and re-running the converter is how it is retuned.
 */
export const TRAPDOOR_CURVE_STEP = 0.0417;
export const TRAPDOOR_CURVE = [
  0.0, 0.0, -0.0024, -0.0088, -0.0181, -0.0291, -0.0407, -0.0517, -0.061, -0.0674, -0.0698, -0.0249, 0.0972, 0.277, 0.4954,
  0.733, 0.9707, 1.1891, 1.3689, 1.4909, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359,
  1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5359, 1.5135, 1.4508, 1.3545, 1.2314, 1.0881, 0.9314,
  0.7679, 0.6045, 0.4478, 0.3045, 0.1814, 0.0851, 0.0224, 0.0,
];

/**
 * How often a placed trap door runs, in seconds. The authored swing itself is
 * 2.17 s of movement with no dwell at all — a leaf that slams shut and
 * immediately loads up again, which is a hole with a floor over it rather
 * than a floor with a hole in it. The rest of this period is the leaf lying
 * shut, and it is the number to play with first.
 */
export const TRAPDOOR_PERIOD_SECONDS = 4;

/** The hinges, measured in the seated file by `pnpm convert:df`. */
const TRAPDOOR_HINGE_Y = 0.29;
const TRAPDOOR_HINGE_X = 2.16;

/**
 * The shooter's authored sweep, in radians and seconds (ADR 0119), read off
 * its clips. The rest pose is baked into the file — the carriage facing
 * straight, the barrel tipped 10° down — so these are amplitudes either side
 * of it, and an author who wants a cannon that stares one way sets the
 * amplitude to 0.
 */
export const SHOOTER_YAW_AMPLITUDE = 0.6109; // ±35°
export const SHOOTER_PITCH_AMPLITUDE = 0.2618; // ±15°, about a rest of 10° down

/**
 * How long each axis takes to sweep out and back. The clip keyframes both at
 * 3.75 s, which locks them together: the muzzle then retraces one line for
 * ever and a Player learns it in two passes. They are separate axes, so they
 * get separate clocks, and the muzzle covers an area instead. The yaw keeps
 * the authored number; the pitch's is chosen not to divide into it.
 */
export const SHOOTER_YAW_SECONDS = 3.75;
export const SHOOTER_PITCH_SECONDS = 2.6;

/** The pivots and the muzzle, measured in the seated file by `pnpm convert:df`. */
const SHOOTER_YAW_PIVOT = { x: 0, y: 0, z: -0.4913 };
const SHOOTER_PITCH_PIVOT = { x: 0, y: 1.05, z: -0.4913 };
/** Where a shot leaves: the authored muzzle flash's own place, just past the ring. */
const SHOOTER_MUZZLE = { x: 0, y: 0.7548, z: 1.1829 };
/** Which way the barrel points at rest: the muzzle seen from the pitch pivot, which is 10° below level. */
const SHOOTER_FORWARD = { x: 0, y: -0.1736, z: 0.9848 };

/**
 * What a placed Shooter does unless its author says otherwise (ADR 0119): a
 * ball every two seconds, living six, which leaves three in the air and a
 * deck with something rolling about on it.
 *
 * The speed is measured rather than guessed. A shot slows on its way, and a
 * Character is a round capsule, so what the Impact rule sees is the closing
 * speed along a contact normal that is rarely square on: at 18 u/s a shot
 * arriving six metres out closed at 10.5 and only ever Staggered. At 24 the
 * same shot closes at 17 and knocks down, while a glancing one still closes
 * at 13.6 and Staggers — which is the speed gate (ADR 0037) doing real work
 * instead of a rule that always says the same thing.
 */
export const SHOOTER_PERIOD_SECONDS = 2;
export const SHOOTER_SPEED = 24;
export const SHOOTER_LIFE_SECONDS = 6;
export const SHOOTER_BALL_RADIUS = 0.25;

/**
 * How many arrivals the fragile block takes: one per authored look — intact,
 * damaged, critical — so the third takes the floor away (ADR 0118).
 */
export const FRAGILE_BLOCK_LOOKS = 3;

/**
 * How long it stays gone, in seconds. The GLB's own extras say only "disable
 * collider and spawn debris" and nothing about coming back, so this is a
 * first guess: long enough that breaking a tile under someone matters, short
 * enough that a Race stays finishable for whoever is last through. `0` here
 * would eat a course permanently, which is an arena author's choice to make
 * per Segment.
 */
export const FRAGILE_BLOCK_RETURN_SECONDS = 6;

/**
 * The conveyor's own loop, measured in the seated file (ADR 0120): rollers on
 * the axis at y 0.68, 2.1 either side of the origin, 0.4 across — which makes
 * the loop 10.913 m, exactly what the export's own extras say. Thirty-six
 * slats share it.
 */
export const BELT_PATH = { rollerZ: 2.1, rollerY: 0.68, radius: 0.4, slats: 36 };

/**
 * How fast a placed belt runs before its author says otherwise: the middle of
 * the three presets a Conveyor has always had (2 / 4 / 8). At 4 u/s it pulls
 * hard enough to be felt and can still be walked against, a walk being 5.5.
 */
export const BELT_PRESET = "medium" as const;

/**
 * The punch, sample for sample as `Puncher_Action_V14` keyframes it at 24 fps
 * (ADR 0121): the fist out 2.31 m and back, the glove growing from nothing,
 * the bellows stretching behind it and the idle button sinking under it.
 * `V13`, an earlier take, is dropped at conversion.
 */
export const PUNCH_CURVE_STEP = 0.0417;
export const PUNCH_REACH = [
  0, 0, 0, 0, 0, 0, 0, 0, 0.0765, 0.2631, 0.4956, 0.7227, 0.946, 1.18, 1.4334, 1.6901, 1.9282, 2.1256, 2.2602,
  2.31, 2.31, 2.31, 2.31, 2.2547, 2.108, 1.8985, 1.6549, 1.4058, 1.18, 0.9969, 0.8393, 0.681, 0.4956, 0.2748,
  0.0823, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
export const PUNCH_GLOVE_SCALE = [
  0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.0972, 0.3154, 0.55, 0.717, 0.819, 0.88, 0.9207, 0.9482,
  0.9662, 0.9783, 0.9884, 1, 1.0089, 1.0102, 1.0067, 0.9972, 0.9803, 0.958, 0.9324, 0.9057, 0.88, 0.853, 0.8051,
  0.7121, 0.55, 0.3167, 0.0979, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001,
];
export const PUNCH_BELLOWS_SCALE = [
  0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1149, 0.1711, 0.2856, 0.4689, 0.7046, 0.97, 1.2429, 1.5052, 1.7394,
  1.9282, 2.0541, 2.1, 2.1, 2.1, 2.1, 2.0487, 1.9106, 1.7098, 1.4701, 1.2156, 0.97, 0.7532, 0.5678, 0.4124, 0.2856,
  0.1872, 0.123, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
];
export const PUNCH_BUTTON_SCALE = [
  1, 1.0017, 1.0052, 1.0084, 1.009, 1.0049, 0.9937, 0.9733, 0.8645, 0.6498, 0.42, 0.2486, 0.1397, 0.08, 0.0467,
  0.0244, 0.0109, 0.0039, 0.0014, 0.001, 0.001, 0.001, 0.001, 0.0041, 0.0128, 0.0258, 0.0421, 0.0606, 0.08, 0.1036,
  0.1517, 0.2489, 0.42, 0.6664, 0.8977, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

/** What each of those scales happens about, measured in the seated file by `pnpm convert:df`. */
const PUNCH_PIVOTS = {
  glove: { x: 0, y: 0.88, z: 0.2118 },
  bellows: { x: 0, y: 0.88, z: 0.0518 },
  button: { x: 0, y: 0.88, z: 0.2318 },
};

/**
 * How much faster than authored the punch is played. The clip crosses its
 * 2.31 m at about 4.6 u/s, which the Impact rule reads as a shove; at 3× the
 * fist is doing over 18 u/s at its quickest, past the 15 that knocks down,
 * and the whole punch takes 0.61 s instead of 1.83. A glove an author slows
 * back down only shoves, which is the gate doing its job rather than a rule
 * that always says the same thing.
 */
export const PUNCH_RATE = 3;

/** How often a placed glove punches, in seconds. A first guess, like every other clock in this pack. */
export const PUNCH_PERIOD_SECONDS = 3;

export const PUNCH_CYCLE = {
  step: PUNCH_CURVE_STEP,
  reach: PUNCH_REACH,
  glove: PUNCH_GLOVE_SCALE,
  bellows: PUNCH_BELLOWS_SCALE,
  button: PUNCH_BUTTON_SCALE,
  pivots: PUNCH_PIVOTS,
  rate: PUNCH_RATE,
  period: PUNCH_PERIOD_SECONDS,
};

const rotorSpin = (rotor: keyof typeof SWEEPER_3ARMS_SPIN) => ({
  spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: SWEEPER_3ARMS_SPIN[rotor], startAngle: SWEEPER_3ARMS_START[rotor] },
});

export const DF_MODULE_DEFS: AssetModuleDef[] = [
  {
    id: "sweeper_3arms",
    category: "sweeper",
    // Measured: a ⌀1.44 tower 2.62 m tall with one 5 m arm per rotor, at
    // y 0.89, 1.51 and 2.13 (⌀0.26). The low arm can be jumped, the middle
    // one cannot and has to be timed, the high one passes over a standing
    // Character. The footprint is the REST pose, the arms laid along ±X; a
    // spinning rotor sweeps a disc of radius 5.82 round the tower, wider
    // than this box on Z. Placing one clear of what it sweeps is the
    // author's job.
    footprint: {
      bounds: { center: { x: 0, y: 1.31, z: 0 }, halfExtents: { x: 5.82, y: 1.31, z: 0.72 } },
      clearance: 0.5,
    },
    sockets: [],
    parts: [
      { name: "tower", role: "still" },
      { name: "low", role: "moving", motion: rotorSpin("low") },
      { name: "mid", role: "moving", motion: rotorSpin("mid") },
      { name: "high", role: "moving", motion: rotorSpin("high") },
    ],
  },
  {
    id: "sweeper_2arms",
    category: "sweeper",
    // Measured: the base is a ⌀3.44 drum the arms clear; the arms reach
    // ±3.762 and pass at y 0.38–1.32, which a 1.7 m Character can neither
    // duck nor comfortably jump. Note that the footprint is the REST pose:
    // a spinning rotor sweeps a disc of radius 3.762, wider than this box on
    // Z. Placing one clear of what it sweeps is the author's job.
    footprint: {
      bounds: { center: { x: 0, y: 0.741, z: 0 }, halfExtents: { x: 3.762, y: 0.741, z: 1.775 } },
      clearance: 0.5,
    },
    sockets: [],
    parts: [
      { name: "base", role: "still" },
      {
        name: "rotor",
        role: "moving",
        motion: { spin: { axis: { x: 0, y: -1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: SWEEPER_ROTOR_SPIN } },
      },
    ],
  },
  {
    id: "trapdoor",
    category: "floor",
    footprint: {
      bounds: { center: { x: 0, y: 0.277, z: 0 }, halfExtents: { x: 2.665, y: 0.276, z: 1.965 } },
      clearance: 0.5,
    },
    sockets: [],
    parts: [
      { name: "frame", role: "still" },
      // The leaves fall away from each other about the same hinge line, each
      // on its own side: the axis sign is what mirrors them, the curve is
      // shared, and both run the same clock unless an author phases them.
      {
        name: "left",
        role: "gated",
        trapDoor: {
          axis: { x: 0, y: 0, z: -1 },
          pivot: { x: -TRAPDOOR_HINGE_X, y: TRAPDOOR_HINGE_Y, z: 0 },
          step: TRAPDOOR_CURVE_STEP,
          curve: TRAPDOOR_CURVE,
          period: TRAPDOOR_PERIOD_SECONDS,
        },
      },
      {
        name: "right",
        role: "gated",
        trapDoor: {
          axis: { x: 0, y: 0, z: 1 },
          pivot: { x: TRAPDOOR_HINGE_X, y: TRAPDOOR_HINGE_Y, z: 0 },
          step: TRAPDOOR_CURVE_STEP,
          curve: TRAPDOOR_CURVE,
          period: TRAPDOOR_PERIOD_SECONDS,
        },
      },
    ],
  },
  {
    id: "shooter",
    category: "sweeper",
    footprint: {
      bounds: { center: { x: 0, y: 0.847, z: 0 }, halfExtents: { x: 0.72, y: 0.847, z: 1.119 } },
      clearance: 0.5,
    },
    sockets: [],
    // Every mesh hangs off the yaw pivot, feet included — the whole carriage
    // turns on its base, as authored — so there is no still Part here.
    // The two Parts collide and are drawn; what aims them is the Shooter's own
    // pair of sweeps below, never a Motion — two axes on one Motion would be
    // one movement, and these two are separate things.
    parts: [
      { name: "carriage", role: "moving", aim: "yaw" },
      { name: "barrel", role: "moving", parent: "carriage", aim: "pitch" },
    ],
    shooter: {
      yaw: { axis: { x: 0, y: -1, z: 0 }, pivot: SHOOTER_YAW_PIVOT, amplitude: SHOOTER_YAW_AMPLITUDE, period: SHOOTER_YAW_SECONDS },
      pitch: { axis: { x: 1, y: 0, z: 0 }, pivot: SHOOTER_PITCH_PIVOT, amplitude: SHOOTER_PITCH_AMPLITUDE, period: SHOOTER_PITCH_SECONDS },
      muzzle: SHOOTER_MUZZLE,
      forward: SHOOTER_FORWARD,
      radius: SHOOTER_BALL_RADIUS,
      periodSeconds: SHOOTER_PERIOD_SECONDS,
      speed: SHOOTER_SPEED,
      lifeSeconds: SHOOTER_LIFE_SECONDS,
    },
  },
  {
    id: "belt",
    category: "floor",
    footprint: {
      bounds: { center: { x: 0, y: 0.61, z: 0 }, halfExtents: { x: 1.26, y: 0.61, z: 2.51 } },
      clearance: 0.5,
    },
    sockets: [],
    // A placed belt already pushes (ADR 0120): it is a belt, so it conveys.
    // An author's own Conveyor on the Segment wins, through the panel that
    // has always set one.
    attachments: { conveyor: { preset: BELT_PRESET, angle: 0 } },
    belt: BELT_PATH,
    // The slats wrap the rollers and reach 5.6 cm past what the rollers
    // collide as — art doing what a belt's slats do, not a mis-seated mesh.
    visualTolerance: 0.07,
  },
  {
    id: "punching_glove",
    category: "sweeper",
    footprint: {
      bounds: { center: { x: 0, y: 0.88, z: 0 }, halfExtents: { x: 0.84, y: 0.88, z: 1.211 } },
      clearance: 0.5,
    },
    sockets: [],
    // The fist is `gated` (ADR 0121): there is no glove at all until it
    // punches, so what hits you is exactly what you can see. The bellows and
    // the button are the same curve's other channels, drawn and never
    // collided.
    parts: [
      { name: "frame", role: "still" },
      { name: "glove", role: "gated", punch: "glove" },
      { name: "bellows", role: "gated", punch: "bellows" },
      { name: "button", role: "gated", punch: "button" },
    ],
    punch: PUNCH_CYCLE,
  },
  {
    id: "fragile_block",
    category: "floor",
    // One body in three authored looks (ADR 0118). Only the intact state
    // collides, so what a Character stands on is the same 2.4 × 0.46 × 2.4
    // box however cracked the tile looks.
    fragile: { entries: FRAGILE_BLOCK_LOOKS, returnSeconds: FRAGILE_BLOCK_RETURN_SECONDS },
    footprint: {
      bounds: { center: { x: 0, y: 0.23, z: 0 }, halfExtents: { x: 1.2, y: 0.23, z: 1.2 } },
      clearance: 0.5,
    },
    // The critical state's two fallen chips lie 6.5 cm past the tile's edge,
    // which is what a chip that fell off looks like — they are art, not a
    // mis-seated mesh, and until they become bodies (ADR 0118) nothing should
    // warn about them every time a Track loads.
    visualTolerance: 0.07,
    sockets: [],
    parts: [{ name: "block", role: "still" }],
  },
];
