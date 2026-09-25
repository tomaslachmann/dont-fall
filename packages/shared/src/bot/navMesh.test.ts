import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "../track/Module.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { trackSpawn, type Segment, type Track } from "../track/Track.js";
import { onTop } from "../track/authoring.js";
import { SURFACES } from "../track/Surface.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { SPIN_CYCLE_TRACK } from "../track/spinCycle.js";
import { SLIP_STREAM_TRACK } from "../track/slipStream.js";
import { navAreaCost, trackNavInput } from "./navInput.js";
import { buildTrackNav, initNavigation, navPath, navSurfaceAt } from "./navMesh.js";
import { botTrackFromData, buildBotTrack, buildBotTrackData, disposeBotTrack, packBotStillWorld, unpackBotStillWorld } from "./Bot.js";
import { initPhysics } from "../simulation/RapierSimulation.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
let library: Record<string, Module>;
beforeAll(async () => {
  await initNavigation();
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});

describe("a Track's navmesh (M17 ticket 01)", () => {
  it.each<[string, Track]>([
    ["the base race", BASE_RACE_TRACK],
    ["Spin Cycle", SPIN_CYCLE_TRACK],
    ["Slip Stream", SLIP_STREAM_TRACK],
  ])("builds for %s, with its spawn on it", (_name, track) => {
    const nav = buildTrackNav(trackNavInput(resolveTrack(library, track)));
    const spawn = trackSpawn(track, 0, library);
    const { success, point } = nav.query.findClosestPoint(spawn, { halfExtents: { x: 0.5, y: 2, z: 0.5 } });
    expect(success).toBe(true);
    expect(Math.hypot(point.x - spawn.x, point.z - spawn.z)).toBeLessThan(0.1);
  });

  it("joins the base race's Start to its first Checkpoint: the sweepers' decks stay still under their bars", () => {
    const resolved = resolveTrack(library, BASE_RACE_TRACK);
    const nav = buildTrackNav(trackNavInput(resolved));
    const target = resolved.checkpoints[0]!.respawn;
    const end = navPath(nav, trackSpawn(BASE_RACE_TRACK, 0, library), target)!.at(-1)!;
    expect(Math.hypot(end.x - target.x, end.z - target.z)).toBeLessThan(0.5);
  });

  it("joins butted decks at every seam, wherever the voxel grid falls (M17 ticket 04)", () => {
    // Two bevelled decks butted together leave a groove 0.1 deep. Before the
    // lip rule, one seam in four cracked the navmesh, depending only on where
    // the grid fell.
    for (const shift of [0, 1, 2.5, 6]) {
      const lane: Track = [6, 18, 30, 42, 54, 66, 78].map((s) => onTop("kaykit_platform_6x6x1_blue", 0, 4, s + shift, { scale: 2 }));
      const nav = buildTrackNav(trackNavInput(resolveTrack(library, lane)));
      const to = { x: 0, y: 5, z: -80 - shift };
      const end = navPath(nav, { x: 0, y: 5, z: -4 - shift }, to)!.at(-1)!;
      expect(Math.hypot(end.x - to.x, end.z - to.z)).toBeLessThan(0.5);
    }
  });

  it("puts each Surface's floor in its own polygons, costed by the Surface's own top speed", () => {
    const deck = (x: number, extra: Partial<Segment> = {}) => onTop("kaykit_platform_6x6x1_blue", x, 4, 6, { scale: 2, ...extra });
    const input = trackNavInput(resolveTrack(library, [deck(-12, { mud: true }), deck(0), deck(12, { ice: true })]));
    const nav = buildTrackNav(input);
    expect(navSurfaceAt(nav, { x: -12, y: 5, z: -6 })).toBe("mud");
    expect(navSurfaceAt(nav, { x: 0, y: 5, z: -6 })).toBe("default");
    expect(navSurfaceAt(nav, { x: 12, y: 5, z: -6 })).toBe("ice");
    // Right at the seams, each side is still its own floor: no polygon straddles two.
    expect(navSurfaceAt(nav, { x: -6.5, y: 5, z: -6 })).toBe("mud");
    expect(navSurfaceAt(nav, { x: -5.5, y: 5, z: -6 })).toBe("default");
    expect(navAreaCost("mud")).toBe(1 / SURFACES.mud!.topSpeedMultiplier);
  });

  it("leaves a moving Segment out: a deck with a Motion is no floor to plan over", () => {
    const deck = BASE_RACE_TRACK[0]!;
    const still = trackNavInput(resolveTrack(library, [deck]));
    const moving = trackNavInput(resolveTrack(library, [{ ...deck, motion: { spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: 1 } } }]));
    expect(still.indices.length).toBeGreaterThan(0);
    expect(moving.indices.length).toBe(0);
  });
});

describe("a Bot's Track built on another thread (M17 ticket 05)", () => {
  it("crosses as plain data and plans exactly as one built here", async () => {
    await initPhysics();
    const resolved = resolveTrack(library, BASE_RACE_TRACK);
    // What the Match server posts to its worker: packed, cloned, unpacked there.
    const { world } = packBotStillWorld(resolved);
    const posted = unpackBotStillWorld(structuredClone(world));
    expect(posted.staticTrimeshes).toEqual(resolved.staticTrimeshes);
    const here = buildBotTrack(resolved);
    const there = botTrackFromData(resolved, structuredClone(buildBotTrackData(posted)));
    try {
      expect(there.nav.links).toEqual(here.nav.links);
      expect(there.nav.surfaces).toEqual(here.nav.surfaces);
      const start = trackSpawn(BASE_RACE_TRACK, 0, library);
      for (const target of resolved.checkpoints) {
        expect(navPath(there.nav, start, target.respawn)).toEqual(navPath(here.nav, start, target.respawn));
      }
    } finally {
      disposeBotTrack(here);
      disposeBotTrack(there);
    }
  }, 60_000);
});
