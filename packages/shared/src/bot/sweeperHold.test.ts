import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { rotateVec3ByQuat, subVec3, addVec3 } from "../math/vec3.js";
import { at, gantry, onTop, slide, spin, wreckingBall } from "../track/authoring.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import type { Module } from "../track/Module.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { SLIP_STREAM_TRACK } from "../track/slipStream.js";
import { SPIN_CYCLE_TRACK } from "../track/spinCycle.js";
import type { Track } from "../track/Track.js";
import { CAPSULE_RADIUS } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { buildBotTrack, disposeBotTrack, type BotTrack } from "./Bot.js";
import { loadTestLibrary, obstacleFalls, playSection, type SectionOutcome } from "./sectionHarness.js";
import { spinAbout, SweeperHold, turnedBack } from "./sweeperHold.js";

/**
 * M17 ticket 07a: a Bot times the sweepers — a wrecking ball, spin bars and a
 * slide wall on small Tracks, and the base race's wrecking-ball leg — never
 * stranded, and fewer obstacle Falls the better it plays.
 */

const TOP = 4;
/** A lane deck 12 m long, centred `s` metres down the course. */
const lane = (s: number, extra: { start?: boolean } = {}) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2, ...extra });
const arch = (s: number) => at("kaykit_arch_wide_yellow", 0, TOP, s, { scale: 2, checkpoint: { order: 1 } });
/** The finish sign on a deck of its own (the base race's finish section), so a Bot through the arch never runs off the lane's end. */
const finish = (s: number) => [lane(s + 2), at("kaykit_signage_finish_wide", 0, TOP, s, { scale: 1.25 })];

const ball = wreckingBall({ x: 0, deckTop: TOP, s: 30, period: 3.4 });
/** A, one wrecking ball swinging across a lane. Built once: the harness keeps a BotTrack per Track object. */
const TRACK_A: Track = [
  lane(6, { start: true }),
  lane(18),
  lane(30),
  ball.segment,
  ...gantry({ color: "red", beamBottom: ball.hubY, s: 30 }),
  lane(42),
  arch(46),
  ...finish(52),
];

/** The base race's fastest sweeper deck: two bars spinning about their middles, staggered along the lane. */
const SWEEPER_STAGGER = 2.8;
const sweeperDeck = (s: number) => [
  lane(s),
  at("kaykit_barrier_4x1x1_blue", -3, TOP + 0.02, s - SWEEPER_STAGGER, { scale: 1.8, motion: spin(2.7) }),
  at("kaykit_barrier_4x1x1_blue", 3, TOP + 0.02, s + SWEEPER_STAGGER, { scale: 1.8, motion: spin(-2.7, Math.PI / 2) }),
];
/** B, spin bars: that deck twice. */
const TRACK_B: Track = [lane(6, { start: true }), ...sweeperDeck(18), ...sweeperDeck(30), lane(42), arch(46), ...finish(52)];

/** C, a slide wall: Spin Cycle's gauntlet wall sliding across a lane. */
const TRACK_C: Track = [
  lane(6, { start: true }),
  lane(18),
  lane(30),
  at("kaykit_barrier_2x1x2_red", 5, TOP, 30, { scale: 1.5, motion: slide({ offset: { x: -10 }, scale: 1.5, period: 3.8 }) }),
  lane(42),
  arch(46),
  ...finish(52),
];

const TRACKS: Record<string, { track: Track; leg: number; capSeconds: number }> = {
  A: { track: TRACK_A, leg: 0, capSeconds: 45 },
  B: { track: TRACK_B, leg: 0, capSeconds: 45 },
  C: { track: TRACK_C, leg: 0, capSeconds: 45 },
  base0: { track: BASE_RACE_TRACK, leg: 0, capSeconds: 60 },
  base1: { track: BASE_RACE_TRACK, leg: 1, capSeconds: 60 },
  // M17 ticket 07i: the three legs whose spin bars no straight walk clears (07g's numbers).
  spin0: { track: SPIN_CYCLE_TRACK, leg: 0, capSeconds: 120 },
  spin1: { track: SPIN_CYCLE_TRACK, leg: 1, capSeconds: 120 },
  slip2: { track: SLIP_STREAM_TRACK, leg: 2, capSeconds: 120 },
};

/** The hook's own time, measured by wrapping `SweeperHold.prototype.hold`: calls and total µs. */
const hookCost = { calls: 0, us: 0 };
const hold = SweeperHold.prototype.hold;
const timed = function (this: SweeperHold, ...args: Parameters<SweeperHold["hold"]>) {
  const started = performance.now();
  try {
    return hold.apply(this, args);
  } finally {
    hookCost.us += (performance.now() - started) * 1000;
    hookCost.calls += 1;
  }
};

/** BOT_PROFILE_HOOK=1 (quick loop): the hook's time split between its parts, logged after the run (M17 ticket 07i's cost work). */
const parts: Record<string, { calls: number; us: number }> = {};
const wrapPart = (name: string): void => {
  const proto = SweeperHold.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const original = proto[name]!;
  parts[name] = { calls: 0, us: 0 };
  proto[name] = function (this: unknown, ...args: unknown[]) {
    const started = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      parts[name]!.us += (performance.now() - started) * 1000;
      parts[name]!.calls += 1;
    }
  };
};
if (process.env.BOT_PROFILE_HOOK) for (const name of ["decide", "planArc", "followArc"]) wrapPart(name);

const play = async (name: string, level: BotLevel, seed?: string): Promise<SectionOutcome & { hookUsPerCall: number; gaveUp: number }> => {
  const { track, leg, capSeconds } = TRACKS[name]!;
  for (const part of Object.values(parts)) {
    part.calls = 0;
    part.us = 0;
  }
  const gaveUpBefore = SweeperHold.gaveUp;
  const arcsBefore = SweeperHold.arcs;
  const droppedBefore = SweeperHold.arcsDropped;
  hookCost.calls = 0;
  hookCost.us = 0;
  // BOT_NOHOLD=1 (quick loop only): the same run with the hook passing every move through, for a baseline.
  SweeperHold.prototype.hold = process.env.BOT_NOHOLD ? (_ctx, steering) => steering : timed;
  let outcome: SectionOutcome;
  try {
    outcome = await playSection({ track, leg, level, seed: seed ?? `sweepers:${name}:${level}`, capSeconds });
  } finally {
    SweeperHold.prototype.hold = hold;
  }
  const result = {
    ...outcome,
    hookUsPerCall: hookCost.us / Math.max(1, hookCost.calls),
    gaveUp: SweeperHold.gaveUp - gaveUpBefore,
    arcs: SweeperHold.arcs - arcsBefore,
    arcsDropped: SweeperHold.arcsDropped - droppedBefore,
  };
  const meanPass = outcome.passTicks.length === 0 ? NaN : (outcome.passTicks.reduce((a, b) => a + b, 0) / outcome.passTicks.length) * TICK_DT;
  console.log(
    `[sweeperHold] ${name} ${level}: passed ${outcome.passed}, stranded ${outcome.stranded}, slow ${outcome.slow}, obstacle Falls ${obstacleFalls(outcome.falls)} ${JSON.stringify(outcome.falls)}, mean pass ${meanPass.toFixed(1)} s, think ${outcome.thinkUsPerBotTick.toFixed(1)} µs/Bot-Tick, hook ${result.hookUsPerCall.toFixed(2)} µs/call over ${hookCost.calls} calls, gave up ${result.gaveUp}, arcs ${result.arcs} (dropped ${result.arcsDropped})`,
  );
  if (process.env.BOT_PROFILE_HOOK) {
    for (const [part, { calls, us }] of Object.entries(parts)) console.log(`  ${part}: ${calls} calls, ${(us / 1000).toFixed(1)} ms in all, ${(us / Math.max(1, calls)).toFixed(1)} µs/call, ${(us / Math.max(1, hookCost.calls)).toFixed(1)} µs per hook call`);
  }
  return result;
};

let library: Record<string, Module>;
const built: BotTrack[] = [];

beforeAll(async () => {
  library = await loadTestLibrary();
}, 120_000);

afterAll(() => {
  for (const track of built) disposeBotTrack(track);
});

describe("a spinning body's occupancy in its own frame (M17 ticket 07i)", () => {
  it("turnedBack: a point's occupancy d Ticks on is the turned-back point's occupancy now, exactly as the poses say", () => {
    const track = buildBotTrack(resolveTrack(library, TRACK_B));
    built.push(track);
    const { moving } = track;
    const bars = moving.sweepers.filter((body) => body.config.motion.spin !== undefined);
    expect(bars.length).toBe(4);
    const grow = CAPSULE_RADIUS + 0.15;
    let tested = 0;
    let occupied = 0;
    for (const body of bars) {
      for (const tick of [0, 17, 300]) {
        const spin = spinAbout(moving, body, tick, null);
        expect(spin, `bar ${body.index} at ${tick}`).not.toBeNull();
        // 2.7 rad/s about its own origin: one turn in 70 Ticks.
        expect(Math.abs(spin!.w)).toBeCloseTo(2.7, 3);
        expect(spin!.period).toBe(Math.round((2 * Math.PI) / 2.7 / TICK_DT));
        expect(spin!.pivot).toEqual(moving.poseAt(body.index, tick, null).position);
        const pose = moving.poseAt(body.index, tick, null);
        for (const d of [0, 1, 5, 23, 47, 70, 131]) {
          const later = moving.poseAt(body.index, tick + d, null);
          const inverse = { x: -later.rotation.x, y: -later.rotation.y, z: -later.rotation.z, w: later.rotation.w };
          for (let gx = -4; gx <= 4; gx += 1) {
            for (let gz = -4; gz <= 4; gz += 1) {
              const p = { x: pose.position.x + gx * 0.7, y: pose.position.y + 0.9, z: pose.position.z + gz * 0.7 };
              // The same point, taken through the poses themselves: into the body's frame at tick + d, out at tick.
              const viaPoses = addVec3(rotateVec3ByQuat(rotateVec3ByQuat(subVec3(p, later.position), inverse), pose.rotation), pose.position);
              const q = turnedBack(spin!, d, p);
              expect(q.x).toBeCloseTo(viaPoses.x, 6);
              expect(q.z).toBeCloseTo(viaPoses.z, 6);
              expect(q.y).toBe(p.y);
              // And the occupancy answers agree.
              const then = moving.occupies(body.index, tick + d, null, p, grow);
              expect(moving.occupies(body.index, tick, null, q, grow)).toBe(then);
              tested += 1;
              if (then) occupied += 1;
            }
          }
        }
      }
    }
    expect(tested).toBe(4 * 3 * 7 * 81);
    // The grid straddles the bars: some points are in one, most are not.
    expect(occupied).toBeGreaterThan(100);
    expect(occupied).toBeLessThan(tested / 2);
  });

  it("spinAbout is null for a body that slides or swings", () => {
    const track = buildBotTrack(resolveTrack(library, [...TRACK_A, ...TRACK_C.slice(3, 4)]));
    built.push(track);
    const { moving } = track;
    const notSpins = moving.sweepers.filter((body) => body.config.motion.spin === undefined);
    expect(notSpins.length).toBeGreaterThanOrEqual(2);
    for (const body of notSpins) expect(spinAbout(moving, body, 10, null), `body ${body.index}`).toBeNull();
  });
});

describe.skipIf(!process.env.BOT_QUICK)("quick", () => {
  it("quick: one Track, one level, one seed", async () => {
    const name = process.env.BOT_LEG ?? "A";
    const level = (process.env.BOT_LEVEL ?? "hard") as BotLevel;
    const outcome = await play(name, level, process.env.BOT_SEED);
    for (const line of outcome.where) console.log(`  ${line}`);
  }, 300_000);
});

describe.skipIf(!!process.env.BOT_QUICK || !process.env.BOT_CROSSES)("spinning crosses (M17 ticket 07i): 12 Bots per level on the three legs 07g measured", () => {
  const LEVELS: BotLevel[] = ["hard", "normal", "easy"];
  const TARGETS: Record<BotLevel, { falls: number; passed: number }> = { hard: { falls: 10, passed: 10 }, normal: { falls: 20, passed: 8 }, easy: { falls: 40, passed: 5 } };
  for (const name of ["spin0", "spin1", "slip2"]) {
    it(`${name}: obstacle Falls ≤ 10 / 20 / 40, passed ≥ 10 / 8 / 5, stranded 0`, async () => {
      for (const level of LEVELS) {
        const out = await play(name, level, `holds:${name}:${level}:0`);
        expect(out.stranded, `${name} ${level} stranded`).toBe(0);
        expect(obstacleFalls(out.falls), `${name} ${level} obstacle Falls`).toBeLessThanOrEqual(TARGETS[level].falls);
        expect(out.passed, `${name} ${level} passed`).toBeGreaterThanOrEqual(TARGETS[level].passed);
      }
    }, 900_000);
  }
});

describe.skipIf(!!process.env.BOT_QUICK)("timing the sweepers (M17 ticket 07a)", () => {
  const LEVELS: BotLevel[] = ["hard", "normal", "easy"];
  const runAll = async (name: string) => {
    const out = {} as Record<BotLevel, Awaited<ReturnType<typeof play>>>;
    for (const level of LEVELS) out[level] = await play(name, level);
    for (const level of LEVELS) expect(out[level].stranded, `${name} ${level} stranded`).toBe(0);
    return out;
  };

  it("A: a wrecking ball — HARD passes all with at most one obstacle Fall, and obstacle Falls rise as the level drops", async () => {
    const { hard, normal, easy } = await runAll("A");
    expect(hard.passed).toBe(12);
    expect(obstacleFalls(hard.falls)).toBeLessThanOrEqual(1);
    expect(normal.passed).toBeGreaterThanOrEqual(10);
    expect(obstacleFalls(normal.falls)).toBeLessThanOrEqual(4);
    expect(easy.passed).toBeGreaterThanOrEqual(6);
    expect(obstacleFalls(easy.falls)).toBeGreaterThan(obstacleFalls(normal.falls));
    expect(obstacleFalls(normal.falls)).toBeGreaterThanOrEqual(obstacleFalls(hard.falls));
  }, 120_000);

  it("B: spin bars", async () => {
    const { hard, normal, easy } = await runAll("B");
    expect(hard.passed).toBe(12);
    expect(obstacleFalls(hard.falls)).toBeLessThanOrEqual(1);
    expect(normal.passed).toBeGreaterThanOrEqual(10);
    expect(obstacleFalls(normal.falls)).toBeLessThanOrEqual(3);
    expect(easy.passed).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it("C: a slide wall", async () => {
    const { hard, normal, easy } = await runAll("C");
    expect(hard.passed).toBe(12);
    expect(obstacleFalls(hard.falls)).toBeLessThanOrEqual(1);
    expect(normal.passed).toBeGreaterThanOrEqual(10);
    expect(easy.passed).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it("the base race's wrecking-ball leg: more pass, fewer fall, strictly EASY > NORMAL > HARD in obstacle Falls", async () => {
    const { hard, normal, easy } = await runAll("base1");
    expect(hard.passed).toBeGreaterThanOrEqual(9);
    expect(obstacleFalls(hard.falls)).toBeLessThanOrEqual(10);
    expect(normal.passed).toBeGreaterThanOrEqual(6);
    expect(obstacleFalls(normal.falls)).toBeLessThanOrEqual(30);
    expect(easy.passed).toBeGreaterThanOrEqual(3);
    expect(obstacleFalls(easy.falls)).toBeGreaterThan(obstacleFalls(normal.falls));
    expect(obstacleFalls(normal.falls)).toBeGreaterThan(obstacleFalls(hard.falls));
    // The think budget (ticket 07a: whole think ≤ 30 µs, the hook's share ≤ 8 µs) is logged above, not
    // asserted: wall-clock µs on a shared CPU move with whatever else runs, and "As built" records them.
  }, 180_000);

  it("the base race's first leg is no queue: HARD still passes 11 and no more than 20% slower than its 31 s baseline", async () => {
    const hard = await play("base0", "hard");
    expect(hard.stranded).toBe(0);
    expect(hard.passed).toBeGreaterThanOrEqual(11);
    const mean = (hard.passTicks.reduce((a, b) => a + b, 0) / hard.passTicks.length) * TICK_DT;
    expect(mean).toBeLessThanOrEqual(31 * 1.2);
  }, 120_000);
});
