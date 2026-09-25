import { describe, expect, it } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { at, disc, onTop, slide, spin, type Extra } from "../track/authoring.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import type { Track } from "../track/Track.js";
import { rideTableOf } from "./rideLinks.js";
import { loadTestLibrary, ownFalls, playSection, sectionBotTrack, type SectionOutcome } from "./sectionHarness.js";

/*
 * M17 ticket 07b: riding a moving floor from still floor and back. Two small
 * Tracks (a sliding row you jump on and off, a turntable you walk on and jump
 * off) and the base race's second leg, five sliding rows in a chain.
 */

const TOP = 4;
const lane = (s: number, extra: Extra = {}) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2, ...extra });
/** After the ride: a lane from s 34, the arch (Checkpoint 0 of the leg), a last lane and the finish. */
const beyond = (): Track => [
  lane(40),
  at("kaykit_arch_wide_yellow", 0, TOP, 44, { scale: 2, checkpoint: { order: 1 } }),
  lane(52),
  at("kaykit_signage_finish_wide", 0, TOP, 56, { scale: 1.25 }),
];

/** R1, a sliding row: the base race's first moving row (6 × 6 m, 8 m across in 4 s), 2 m of air either side. */
const R1: Track = [
  lane(6, { start: true }),
  lane(18),
  onTop("kaykit_platform_4x4x1_yellow", -4, TOP, 29, { scale: 1.5, motion: slide({ offset: { x: 8, s: 0 }, scale: 1.5, period: 4 }) }),
  ...beyond(),
];

/** R2, a turntable: a lane butted against a disc of radius 4 (eight pieces, one platform), 2 m of air beyond it. */
const R2: Track = [lane(6, { start: true }), lane(18), ...disc(0, TOP, 28, 4, { motion: spin(0.8) }), ...beyond()];

const TRACKS: Record<string, { track: Track; leg: number; cap: number }> = {
  R1: { track: R1, leg: 0, cap: 60 },
  R2: { track: R2, leg: 0, cap: 60 },
  base: { track: BASE_RACE_TRACK, leg: 2, cap: 90 },
  /** M17 ticket 07h: the same leg with twelve Bots arriving together, as a whole Race delivers them; NORMAL and EASY get the cap to record a time. */
  crowd: { track: BASE_RACE_TRACK, leg: 2, cap: 150 },
};

const run = async (name: string, level: BotLevel, seed?: string): Promise<SectionOutcome> => {
  const { track, leg, cap } = TRACKS[name]!;
  return playSection({ track, leg, level, seed: seed ?? `rides:${name}:${level}`, capSeconds: cap });
};

const describeTable = async (name: string): Promise<string> => {
  const library = await loadTestLibrary();
  const botTrack = sectionBotTrack(TRACKS[name]!.track, library);
  const table = rideTableOf(botTrack);
  const ends = table.ends.map(
    (e) => `  p${e.platform} ${e.jump ? "jump" : "walk"} local (${e.local.x.toFixed(1)}, ${e.local.z.toFixed(1)}) still (${e.still.x.toFixed(1)}, ${e.still.y.toFixed(1)}, ${e.still.z.toFixed(1)}) hits ${e.hits} comp ${table.component[table.ends.indexOf(e)]} walkFromStart ${table.walk({ x: 0, y: 4.1, z: -6 }, e.still)?.toFixed(1)} links ${table.links.filter((l) => l.entry === e).length}`,
  );
  return `${name}: ${botTrack.moving.platforms.length} platforms (${botTrack.moving.platforms.map((p) => p.bodies.length).join(", ")} bodies), ${table.ends.length} ends, ${table.links.length} rides, built in ${table.buildMs.toFixed(1)} ms\n${ends.join("\n")}`;
};

describe.skipIf(!process.env.BOT_QUICK)("quick", () => {
  it("one Track, one level", async () => {
    const name = process.env.BOT_LEG ?? "R1";
    const level = (process.env.BOT_LEVEL ?? "hard") as BotLevel;
    console.log(await describeTable(name));
    const started = performance.now();
    const outcome = await run(name, level, process.env.BOT_SEED);
    console.log(`[07b quick] ${name} ${level}: ${JSON.stringify({ ...outcome, where: undefined })} in ${(performance.now() - started).toFixed(0)} ms`);
    for (const line of outcome.where) console.log(`  ${line}`);
  }, 600_000);
});

describe("riding moving floors (M17 ticket 07b)", () => {
  it("finds the platforms and their ends: a sliding row jumped on and off, a turntable walked on and jumped off", async () => {
    const library = await loadTestLibrary();
    for (const [name, platforms] of [["R1", 1], ["R2", 1]] as const) {
      const botTrack = sectionBotTrack(TRACKS[name]!.track, library);
      expect(botTrack.moving.platforms).toHaveLength(platforms);
      const table = rideTableOf(botTrack);
      console.log(await describeTable(name));
      // The row is only ever jumped onto; the turntable is walked onto from the lane butted against it.
      if (name === "R1") expect(table.ends.some((e) => !e.jump)).toBe(false);
      else expect(table.ends.some((e) => !e.jump && -e.still.z < 25)).toBe(true);
      expect(table.ends.some((e) => e.jump && -e.still.z > 33)).toBe(true);
      expect(table.links.some((l) => -l.entry.still.z < 25 && -l.exit.still.z > 33)).toBe(true);
    }
    const base = rideTableOf(sectionBotTrack(BASE_RACE_TRACK, library));
    console.log(`[07b] base race ride table: ${base.ends.length} ends, ${base.links.length} rides, built in ${base.buildMs.toFixed(1)} ms`);
    expect(base.buildMs).toBeLessThan(50);
  }, 120_000);

  const THRESHOLDS: Record<string, Record<BotLevel, { passed: number; own?: number }>> = {
    R1: { hard: { passed: 11, own: 1 }, normal: { passed: 10, own: 2 }, easy: { passed: 6, own: 6 } },
    R2: { hard: { passed: 11, own: 1 }, normal: { passed: 10, own: 2 }, easy: { passed: 6, own: 6 } },
    base: { hard: { passed: 8, own: 3 }, normal: { passed: 6 }, easy: { passed: 3 } },
  };
  for (const name of Object.keys(THRESHOLDS)) {
    for (const level of ["hard", "normal", "easy"] as const) {
      it(`${name} at ${level}`, async () => {
        const outcome = await run(name, level);
        console.log(`[07b] ${name} ${level}: ${JSON.stringify({ ...outcome, passTicks: undefined, where: undefined })}`);
        for (const line of outcome.where) console.log(`  ${line}`);
        const want = THRESHOLDS[name]![level];
        expect(outcome.stranded).toBe(0);
        expect(outcome.passed).toBeGreaterThanOrEqual(want.passed);
        if (want.own !== undefined) expect(ownFalls(outcome.falls)).toBeLessThanOrEqual(want.own);
        if (name === "base" && level === "hard") expect(outcome.thinkUsPerBotTick).toBeLessThanOrEqual(40);
      }, 300_000);
    }
  }

  // M17 ticket 07h: the base race's moving rows with a crowd — twelve Bots spawned on Checkpoint 1's deck at once. The rule
  // (ADR 0129, "never steps off") is asserted here: a Fall off a moving deck is the Bot's own unless another Character touched it.
  const CROWD: Record<BotLevel, { passed: number; withinTicks?: number }> = {
    hard: { passed: 9, withinTicks: 90 * 30 },
    normal: { passed: 6 },
    easy: { passed: 3 },
  };
  for (const level of ["hard", "normal", "easy"] as const) {
    it(`moving rows with a crowd at ${level} (07h)`, async () => {
      const outcome = await run("crowd", level, `crowd:base:${level}`);
      const slowest = Math.max(0, ...outcome.passTicks);
      console.log(`[07h] crowd ${level}: ${JSON.stringify({ ...outcome, passTicks: undefined, where: undefined })} slowest pass at tick ${slowest}`);
      for (const line of outcome.where) console.log(`  ${line}`);
      const want = CROWD[level];
      expect(outcome.falls["step-off"] ?? 0).toBe(0);
      expect(outcome.stranded).toBe(0);
      expect(outcome.passed).toBeGreaterThanOrEqual(want.passed);
      if (want.withinTicks !== undefined) expect(slowest).toBeLessThanOrEqual(want.withinTicks);
    }, 300_000);
  }
});
