import { describe, expect, it } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { at, disc, onTop, spin, type Extra } from "../track/authoring.js";
import { SPIN_CYCLE_TRACK } from "../track/spinCycle.js";
import type { Track } from "../track/Track.js";
import { rideTableOf } from "./rideLinks.js";
import { loadTestLibrary, ownFalls, playSection, sectionBotTrack, type SectionOutcome } from "./sectionHarness.js";

/*
 * M17 ticket 07e: moving-to-moving transfers. Three small Tracks where a Bot
 * jumps from one moving floor onto another: two turntables, two carousels,
 * two spinning squares. Every leg is 0 / 12 without the transfer ends.
 */

const TOP = 4;
const lane = (s: number, extra: Extra = {}) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2, ...extra });
/** After the rides: a lane centred at `s`, the arch (Checkpoint of the leg), a last lane and the finish. */
const beyond = (s: number): Track => [
  lane(s),
  at("kaykit_arch_wide_yellow", 0, TOP, s + 4, { scale: 2, checkpoint: { order: 1 } }),
  lane(s + 12),
  at("kaykit_signage_finish_wide", 0, TOP, s + 16, { scale: 1.25 }),
];

/** T1, two turntables: a lane butted against a disc of radius 4, another 2 m on turning the other way, a lane 2 m beyond it. */
const T1: Track = [
  lane(6, { start: true }),
  lane(18),
  ...disc(0, TOP, 28, 4, { motion: spin(0.8) }),
  ...disc(1.5, TOP, 38, 4, { motion: spin(-0.9) }),
  ...beyond(50),
];

/** T2, two carousels: 16 m discs with a metre of air between, a lane 1 m before and 1 m after. */
const T2: Track = [
  lane(6, { start: true }),
  lane(18),
  ...disc(0, TOP, 33, 8, { motion: spin(0.45) }),
  ...disc(0, TOP, 50, 8, { motion: spin(-0.5) }),
  ...beyond(65),
];

/** T3, two spinning squares: 9 m decks turned 45°, 15 m apart as the base race has them, so their corners meet every quarter turn. */
const T3: Track = [
  lane(6, { start: true }),
  lane(18),
  onTop("kaykit_platform_6x6x1_blue", 0, TOP, 31.5, { scale: 1.5, rotation: Math.PI / 4, motion: spin(0.55) }),
  onTop("kaykit_platform_6x6x1_green", 0, TOP, 46.5, { scale: 1.5, rotation: Math.PI / 4, motion: spin(-0.55) }),
  ...beyond(60),
];

const TRACKS: Record<string, { track: Track; leg: number; cap: number }> = {
  T1: { track: T1, leg: 0, cap: 60 },
  T2: { track: T2, leg: 0, cap: 60 },
  T3: { track: T3, leg: 0, cap: 60 },
};

const run = async (name: string, level: BotLevel, seed?: string): Promise<SectionOutcome> => {
  const { track, leg, cap } = TRACKS[name]!;
  return playSection({ track, leg, level, seed: seed ?? `transfers:${name}:${level}`, capSeconds: cap });
};

const describeTable = async (name: string): Promise<string> => {
  const library = await loadTestLibrary();
  const botTrack = sectionBotTrack(TRACKS[name]!.track, library);
  const table = rideTableOf(botTrack);
  const ends = table.ends.map(
    (e, i) =>
      `  p${e.platform} ${e.to === null ? (e.jump ? "jump" : "walk") : `transfer→p${e.to.platform}`} local (${e.local.x.toFixed(1)}, ${e.local.z.toFixed(1)}) still (${e.still.x.toFixed(1)}, ${e.still.y.toFixed(1)}, ${e.still.z.toFixed(1)}) hits ${e.hits} comp ${table.component[i]} mirror ${table.mirror[i]} links ${table.links.filter((l) => l.entry === e).length}`,
  );
  return `${name}: ${botTrack.moving.platforms.length} platforms (${botTrack.moving.platforms.map((p) => p.bodies.length).join(", ")} bodies), ${table.ends.length} ends, ${table.links.length} rides, built in ${table.buildMs.toFixed(1)} ms\n${ends.join("\n")}`;
};

describe.skipIf(!process.env.BOT_QUICK)("quick", () => {
  it("one Track, one level", async () => {
    const name = process.env.BOT_LEG ?? "T1";
    const level = (process.env.BOT_LEVEL ?? "hard") as BotLevel;
    console.log(await describeTable(name));
    const started = performance.now();
    const outcome = await run(name, level, process.env.BOT_SEED);
    console.log(`[07e quick] ${name} ${level}: ${JSON.stringify({ ...outcome, where: undefined })} in ${(performance.now() - started).toFixed(0)} ms`);
    for (const line of outcome.where) console.log(`  ${line}`);
  }, 600_000);
});

describe("moving-to-moving transfers (M17 ticket 07e)", () => {
  it("finds transfer ends between the two platforms of each Track, mirrored, and builds Spin Cycle's table in budget", async () => {
    const library = await loadTestLibrary();
    for (const name of ["T1", "T2", "T3"]) {
      const botTrack = sectionBotTrack(TRACKS[name]!.track, library);
      expect(botTrack.moving.platforms).toHaveLength(2);
      const table = rideTableOf(botTrack);
      console.log(await describeTable(name));
      const transfers = table.ends.filter((e) => e.to !== null);
      expect(transfers.some((e) => e.platform === 0 && e.to!.platform === 1)).toBe(true);
      expect(transfers.some((e) => e.platform === 1 && e.to!.platform === 0)).toBe(true);
      for (const [i, end] of table.ends.entries()) {
        const mirror = table.mirror[i]!;
        if (end.to === null) expect(mirror).toBe(-1);
        else expect(table.mirror[mirror]).toBe(i);
      }
      // A way across: a ride onto the first platform's transfer end, and a ride from the second's onto still floor beyond.
      expect(table.links.some((l) => l.entry.to === null && l.exit.to !== null && l.entry.platform === 0)).toBe(true);
      expect(table.links.some((l) => l.entry.to !== null && l.exit.to === null && l.entry.platform === 1)).toBe(true);
    }
    const spin = rideTableOf(sectionBotTrack(SPIN_CYCLE_TRACK, library));
    console.log(
      `[07e] Spin Cycle ride table: ${spin.ends.length} ends (${spin.ends.filter((e) => e.to !== null).length} transfer), ${spin.links.length} rides, built in ${spin.buildMs.toFixed(1)} ms, of which transfers ${spin.transferMs.toFixed(1)} ms`,
    );
    // The whole table's time is 07b's still-end scan (measured: 145 ms on Spin Cycle before any transfer end); the transfer scan is what this part answers for.
    expect(spin.transferMs).toBeLessThan(80);
  }, 120_000);

  const THRESHOLDS: Record<BotLevel, { passed: number; own?: number }> = {
    hard: { passed: 10, own: 2 },
    normal: { passed: 8 },
    easy: { passed: 4 },
  };
  for (const name of Object.keys(TRACKS)) {
    for (const level of ["hard", "normal", "easy"] as const) {
      it(`${name} at ${level}`, async () => {
        const outcome = await run(name, level);
        console.log(`[07e] ${name} ${level}: ${JSON.stringify({ ...outcome, passTicks: undefined, where: undefined })}`);
        for (const line of outcome.where) console.log(`  ${line}`);
        const want = THRESHOLDS[level];
        expect(outcome.stranded).toBe(0);
        expect(outcome.passed).toBeGreaterThanOrEqual(want.passed);
        if (want.own !== undefined) expect(ownFalls(outcome.falls)).toBeLessThanOrEqual(want.own);
        expect(outcome.thinkUsPerBotTick).toBeLessThanOrEqual(40);
      }, 300_000);
    }
  }
});
