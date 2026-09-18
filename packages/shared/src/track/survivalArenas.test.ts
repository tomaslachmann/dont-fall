import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import { type Track } from "./Track.js";
import { loadAssetLibrary } from "./assetModules.js";
import { invalidTrackCourseReason, startSegmentIndex } from "./Course.js";
import { MAX_PLAYERS } from "../tuning/match.js";
import { initPhysics } from "../simulation/RapierSimulation.js";
import { standOn, walkTrack, type Waypoint } from "./walkTrack.js";
import { findOverlaps } from "./trackOverlaps.js";
import { COG_ARENA_TRACK } from "./cogArena.js";
import { SKY_RINGS_TRACK } from "./skyRings.js";

beforeAll(async () => {
  await initPhysics();
});

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
let library: Record<string, Module>;
beforeAll(async () => {
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});

const ARENAS: [string, Track][] = [
  ["Cog Arena", COG_ARENA_TRACK],
  ["Sky Rings", SKY_RINGS_TRACK],
];

describe.each(ARENAS)("%s", (_name, track) => {
  it("is an arena, not a course: a Start, no Checkpoints, no finish, no warnings", () => {
    expect(invalidTrackCourseReason(track, library)).toBeUndefined();
    expect(startSegmentIndex(track)).toBeDefined();
    const resolved = resolveTrack(library, track);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.checkpoints).toHaveLength(0);
    expect(resolved.finishZones).toHaveLength(0);
  });

  /** The brief the four authored Tracks were written to (2026-09-18): a hundred Segments or more, everywhere. */
  it("has a hundred Segments or more", () => {
    expect(track.length).toBeGreaterThanOrEqual(100);
  });

  /**
   * No piece sits inside another, at rest or anywhere its Motion takes it
   * (the user, 2026-09-18): two decks overlapping fight over every pixel of
   * their shared top, and a bar swept through a piston clips through it.
   */
  it("places nothing inside anything else, through every instant of every Motion", () => {
    const overlaps = findOverlaps(library, track).map(
      ({ a, b, depth, tick }) => `${a} ${track[a]!.moduleId} × ${b} ${track[b]!.moduleId}: ${depth.toFixed(2)} m at tick ${tick}`,
    );
    expect(overlaps).toEqual([]);
  });

  /**
   * A full lobby stands through the Countdown with its input locked. Nothing
   * here should be able to take a Player out before the Round has started —
   * which on an arena built round turning arms is entirely possible to get
   * wrong, and impossible to notice except live.
   */
  it("spawns a full lobby on floor and holds it there through a Countdown", () => {
    const outcome = standOn(library, track, MAX_PLAYERS, 4);
    expect(outcome.falls, `positions: ${JSON.stringify(outcome.positions)}`).toBe(0);
    expect(outcome.grounded).toBe(MAX_PLAYERS);
  });
});

/** A waypoint `radius` metres out from the middle, `degrees` round from straight ahead. */
const polar = (radius: number, degrees: number, extra: Partial<Waypoint> = {}): Waypoint => ({
  x: radius * Math.sin((degrees * Math.PI) / 180),
  s: radius * Math.cos((degrees * Math.PI) / 180),
  radius: 0.5,
  ...extra,
});

describe("Cog Arena's levels", () => {
  /**
   * The whole point of the three levels, walked with every Motion stopped:
   * off the Start tooth's tip, the rim catches you; from the rim a ledge is
   * one jump up; and the ledge's rebound puts you back on the hub.
   */
  it("catches a Player off a tooth's tip on the rim, and brings them back to the hub by the ledges", () => {
    const outcome = walkTrack(library, COG_ARENA_TRACK, [
      polar(16.6, 0, { radius: 0.8 }), // off the tip, onto the rim
      polar(16.6, 22.5), // round the rim, under a ledge
      polar(16.1, 22.5, { jump: true, radius: 0.4 }), // up onto the ledge
      polar(12.2, 22.5, { jump: true, radius: 0.4 }), // the rebound
      polar(6, 22.5, { radius: 1 }), // back on the hub
    ], { maxSeconds: 60 });

    expect(outcome.stuckAt).toBeUndefined();
    expect(outcome.reached).toBe(5);
    expect(outcome.fallCount).toBe(0);
  });
});

describe("Sky Rings' bars", () => {
  /** A spoke's bar and a plain ring's pair, stopped across the way: every one is a jump, not a wall. */
  it("can all be jumped: off the hub, over the spoke's bar, over the ring's", () => {
    const outcome = walkTrack(library, SKY_RINGS_TRACK, [
      polar(8, 0, { radius: 0.8 }),
      polar(10.4, 0, { jump: true, radius: 0.4 }), // the spoke's bar stands across it at 12
      polar(14, 0, { radius: 0.8 }),
      polar(19.3, 0, { jump: true, radius: 0.4 }), // the ring's bars stand across it at 21
      polar(23.5, 0, { radius: 0.8 }),
    ], { maxSeconds: 60 });

    expect(outcome.stuckAt).toBeUndefined();
    expect(outcome.reached).toBe(5);
    expect(outcome.fallCount).toBe(0);
  });
});
