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
import { standOn } from "./walkTrack.js";
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
