import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { movingSegmentPose } from "../simulation/MovingSegment.js";
import { at, onTop } from "../track/authoring.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import type { Module } from "../track/Module.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { SPIN_CYCLE_TRACK } from "../track/spinCycle.js";
import type { Track } from "../track/Track.js";
import { punchPose } from "../track/Punch.js";
import { trapDoorPose } from "../track/TrapDoor.js";
import { buildBotTrack, disposeBotTrack, type BotTrack } from "./Bot.js";
import { movingWorldOf } from "./movingWorld.js";
import { BOT_HOLD_MARGIN_M } from "../tuning/bots.js";
import { CAPSULE_RADIUS } from "../tuning/character.js";
import { BROKEN_FLAG, GATED_FLAG, LAST_CRACK_FLAG, navCorners } from "./navMesh.js";
import { besideCrosses } from "./PathBot.js";
import { loadTestLibrary } from "./sectionHarness.js";

/**
 * M17 ticket 07's groundwork: the moving bodies as every Bot reads them
 * (`movingWorld.ts`) and gated floors on the navmesh.
 */

let library: Record<string, Module>;
const built: BotTrack[] = [];
const botTrackOf = (track: Track): BotTrack => {
  const botTrack = buildBotTrack(resolveTrack(library, track));
  built.push(botTrack);
  return botTrack;
};

const TOP = 4;
const lane = (s: number) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2 });

beforeAll(async () => {
  library = await loadTestLibrary();
}, 120_000);

afterAll(() => {
  for (const track of built) disposeBotTrack(track);
});

describe("the moving world (M17 ticket 07)", () => {
  it("poses every body as movingSegmentPose does, at any Tick, under a Ramp on the Motion Clock too", () => {
    const track = botTrackOf(BASE_RACE_TRACK);
    const { moving, resolved } = track;
    expect(moving.bodies.length).toBe(resolved.movingSegments.length);
    for (const tick of [0, 1, 17, 300, 301]) {
      for (const body of moving.bodies) {
        expect(moving.poseAt(body.index, tick, null)).toEqual(movingSegmentPose(body.config, tick, null));
      }
    }
    // A Ramp counts from the Motion Clock (ADR 0123): a new clock flushes the cache.
    const ramped = movingWorldOf(
      { ...resolved, movingSegments: resolved.movingSegments.map((config) => ({ ...config, motion: { ...config.motion, ramp: { multiplier: 3, seconds: 4 } } })) },
      track.nav,
    );
    for (const tick of [0, 200, 400]) {
      for (const body of ramped.bodies) {
        expect(ramped.poseAt(body.index, tick, 30)).toEqual(movingSegmentPose(body.config, tick, 30));
        expect(ramped.poseAt(body.index, tick, 60)).toEqual(movingSegmentPose(body.config, tick, 60));
      }
    }
    // A point riding a body moves as the body carries it.
    const spinning = moving.bodies.find((body) => body.config.motion.spin !== undefined)!;
    const p = moving.poseAt(spinning.index, 10, null).position;
    const v = moving.velocityAt(spinning.index, 10, null, { x: p.x + 1, y: p.y, z: p.z });
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(Math.abs(spinning.config.motion.spin!.speed) * 1, 1);
  });

  it("near: the per-body stray bound (M17 ticket 07i) never drops a body a walk over the window would find, on a clock and off", () => {
    const { moving } = botTrackOf(SPIN_CYCLE_TRACK);
    // What `near` answered before the bound: every body's origin walked over [tick, tick + window].
    const walked = (p: { x: number; y: number; z: number }, reach: number, tick: number, window: number, clock: number | null): number[] => {
      const out: number[] = [];
      for (const body of moving.sweepers) {
        const within = body.radius + reach;
        for (let t = tick; t <= tick + window; t += 1) {
          const q = moving.poseAt(body.index, t, clock).position;
          if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= within) {
            out.push(body.index);
            break;
          }
        }
      }
      return out;
    };
    // A seeded walk of points over the Track's extent, about the bodies' own heights.
    let s = 12345;
    const draw = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    let found = 0;
    let asked = 0;
    for (const clock of [null, 40]) {
      for (let n = 0; n < 400; n += 1) {
        const body = moving.sweepers[Math.floor(draw() * moving.sweepers.length)]!;
        const rest = moving.poseAt(body.index, 0, null).position;
        const p = { x: rest.x + (draw() - 0.5) * 30, y: rest.y + (draw() - 0.5) * 4, z: rest.z + (draw() - 0.5) * 30 };
        const tick = Math.floor(draw() * 600);
        const window = Math.floor(draw() * 24);
        const expected = walked(p, 8, tick, window, clock);
        const got = moving.near(p, 8, tick, window, clock, ["sweeper"]).map((b) => b.index);
        expect(got, `point ${JSON.stringify(p)} tick ${tick} window ${window} clock ${clock}`).toEqual(expected);
        found += expected.length;
        asked += 1;
      }
    }
    // The walk is a real test only if it finds bodies sometimes, and misses them sometimes.
    expect(found).toBeGreaterThan(asked / 4);
    expect(found).toBeLessThan(asked * moving.sweepers.length);
  });

  it("classifies the base race's and Spin Cycle's bodies by what they are to a runner", () => {
    for (const [name, track] of [
      ["base race", BASE_RACE_TRACK],
      ["Spin Cycle", SPIN_CYCLE_TRACK],
    ] as const) {
      const { moving } = botTrackOf(track);
      const counts = { floor: moving.floors.length, sweeper: moving.sweepers.length, gate: moving.gates.length, fragile: moving.fragile.length };
      console.log(`[movingWorld] ${name}: ${JSON.stringify(counts)}, platforms ${moving.platforms.length} (${moving.platforms.map((p) => p.bodies.length).join(",")})`);
      expect(counts.floor + counts.sweeper + counts.gate + counts.fragile).toBe(moving.bodies.length);
      // The Races have no trap doors or fragile floors.
      expect(counts.gate).toBe(0);
      expect(counts.fragile).toBe(0);
      // Both have floors you ride and sweepers that hit you.
      expect(counts.floor).toBeGreaterThan(0);
      expect(counts.sweeper).toBeGreaterThan(0);
      // A hazard is never a floor; every floor has a deck; a platform is floors moving as one.
      for (const body of moving.floors) {
        expect(body.spiked).toBe(false);
        expect(body.deck).not.toBeNull();
        expect(body.deck!.hull.length).toBeGreaterThanOrEqual(3);
      }
      for (const platform of moving.platforms) {
        expect(platform.bodies.every((body) => body.role === "floor")).toBe(true);
        expect(platform.periodTicks).toBeGreaterThan(0);
        // A point on the deck reads as under it, and round-trips through the platform frame.
        const centre = platform.deck.hull.reduce((sum, c) => ({ x: sum.x + c.x / platform.deck.hull.length, z: sum.z + c.z / platform.deck.hull.length }), { x: 0, z: 0 });
        const local = { x: centre.x, y: platform.deck.y + 0.9, z: centre.z };
        const world = moving.toWorld(platform, 40, null, local);
        const back = moving.toLocal(platform, 40, null, world);
        expect(back.x).toBeCloseTo(local.x, 6);
        expect(back.z).toBeCloseTo(local.z, 6);
      }
      expect(moving.platforms.reduce((sum, p) => sum + p.bodies.length, 0)).toBe(moving.floors.length);
    }
    // Spin Cycle's carousel: several quarter pieces on one spin.
    const spin = botTrackOf(SPIN_CYCLE_TRACK).moving;
    expect(spin.platforms.some((platform) => platform.bodies.length >= 4)).toBe(true);
  });

  it("crosses (M17 ticket 07i, round 3): Spin Cycle's cross is its two bars on one axle, and a first plan keeps beside it", () => {
    const { moving, nav } = botTrackOf(SPIN_CYCLE_TRACK);
    // The cross 07g measured (Segments 33 and 34): each bar alone has a window, together they have none.
    const cross = moving.crosses.find((c) => c.bodies.some((body) => body.config.segmentIndex === 33))!;
    expect(cross).toBeDefined();
    expect(cross.bodies.map((body) => body.config.segmentIndex).sort()).toEqual([33, 34]);
    expect(moving.crosses.every((c) => c.bodies.every((body) => body.role === "sweeper" && body.config.motion.spin !== undefined))).toBe(true);
    console.log(`[movingWorld] Spin Cycle crosses: ${moving.crosses.map((c) => c.bodies.map((b) => b.config.segmentIndex).join("+")).join(" ")}`);
    // A straight plan through the cross walks through its swath; kept beside it, it joins and keeps out.
    const { pivot } = cross;
    const y = pivot.y - 0.5;
    const from = { x: pivot.x, y, z: pivot.z + 7 };
    const to = { x: pivot.x, y, z: pivot.z - 7 };
    const through = navCorners(nav, from, to)!;
    expect(through).not.toBeNull();
    const beside = besideCrosses(nav, moving.crosses, from, to, through, undefined);
    expect(beside).not.toBeNull();
    const last = beside!.at(-1)!.point;
    expect(Math.hypot(last.x - to.x, last.z - to.z)).toBeLessThan(1);
    const swath = cross.radius + CAPSULE_RADIUS + BOT_HOLD_MARGIN_M;
    const nearest = (corners: { point: { x: number; z: number } }[]): number => {
      let best = Infinity;
      for (let i = 1; i < corners.length; i += 1) {
        const a = corners[i - 1]!.point;
        const b = corners[i]!.point;
        for (let t = 0; t <= 1; t += 0.05) best = Math.min(best, Math.hypot(a.x + (b.x - a.x) * t - pivot.x, a.z + (b.z - a.z) * t - pivot.z));
      }
      return best;
    };
    expect(nearest(beside!)).toBeGreaterThan(swath - 0.5);
    expect(nearest(through)).toBeLessThan(swath - 0.5);
    // A single bar is never a cross, however fast: every cross is at least two bodies on one axle.
    expect(moving.crosses.every((c) => c.bodies.length >= 2)).toBe(true);
    expect(moving.crosses.some((c) => c.bodies.some((body) => [36, 37, 119].includes(body.config.segmentIndex)))).toBe(false);
  });

  it("poses a trap door's leaf and a glove by their own clocks, and knows when each is solid", () => {
    const track: Track = [lane(0), at("trapdoor", 0, TOP - 0.55, 8), at("punching_glove", 3, TOP, 14), lane(20)];
    const { moving, resolved } = botTrackOf(track);
    expect(moving.gates.length).toBeGreaterThan(0);
    const leaf = moving.gates[0]!;
    for (const tick of [0, 5, 50]) {
      expect(moving.poseAt(leaf.index, tick, null)).toEqual(movingSegmentPose(leaf.config, tick, null));
      const local = trapDoorPose(leaf.config.trapDoor!, tick);
      expect(moving.poseAt(leaf.index, tick, null).rotation).not.toBeUndefined();
      void local;
    }
    const glove = moving.sweepers.find((body) => body.config.punch?.piece === "glove");
    expect(glove).toBeDefined();
    for (const tick of [0, 9, 33]) {
      const expected = punchPose(glove!.config.punch!.cycle, tick, "glove");
      expect(moving.poseAt(glove!.index, tick, null).position).toEqual(movingSegmentPose(glove!.config, tick, null).position);
      void expected;
    }
    // Solid at some Ticks and not others, over one period each.
    const leafSolid = new Set<boolean>();
    const gloveSolid = new Set<boolean>();
    const period = Math.round((leaf.config.trapDoor!.period / (1 / 30)) * 1.05);
    for (let tick = 0; tick < period; tick += 1) {
      leafSolid.add(moving.solidAt(leaf.index, tick, undefined));
      gloveSolid.add(moving.solidAt(glove!.index, tick, undefined));
    }
    expect([...leafSolid].sort()).toEqual([false, true]);
    expect([...gloveSolid].sort()).toEqual([false, true]);
    expect(resolved.movingSegments.length).toBe(moving.bodies.length);
  });

  it("puts a gated floor on the navmesh, flagged, and takes a broken fragile block off every route", () => {
    // Two lanes with a gap only the fragile block bridges (a lane is 12 m; the block 2.4).
    const track: Track = [lane(0), at("fragile_block", 0, TOP - 0.46, 7.2), lane(14.4)];
    const { nav, moving, resolved } = botTrackOf(track);
    expect(moving.fragile.length).toBe(1);
    expect(nav.gated).toBeDefined();
    expect(nav.gated!.size).toBeGreaterThan(0);
    const block = moving.fragile[0]!;
    for (const [ref, segmentIndex] of nav.gated!) {
      expect(segmentIndex).toBe(block.config.segmentIndex);
      expect(nav.navMesh.getPolyFlags(ref).flags & GATED_FLAG).toBe(GATED_FLAG);
    }
    const from = { x: 0, y: TOP, z: 0 };
    const to = { x: 0, y: TOP, z: -14.4 };
    const joins = (): boolean => {
      const corners = navCorners(nav, from, to);
      const last = corners?.at(-1)?.point;
      return last !== undefined && Math.hypot(last.x - to.x, last.z - to.z) < 1;
    };
    expect(joins()).toBe(true);
    const def = block.config.fragile!;
    // One arrival from breaking: flagged, still a route.
    moving.syncFragile(nav, [{ segmentIndex: block.config.segmentIndex, hits: def.entries - 1, returnTick: null }]);
    for (const ref of nav.gated!.keys()) expect(nav.navMesh.getPolyFlags(ref).flags & LAST_CRACK_FLAG).toBe(LAST_CRACK_FLAG);
    expect(joins()).toBe(true);
    // Broken: no route joins, and it is not solid.
    moving.syncFragile(nav, [{ segmentIndex: block.config.segmentIndex, hits: def.entries, returnTick: 900 }]);
    for (const ref of nav.gated!.keys()) {
      expect(nav.navMesh.getPolyFlags(ref).flags & BROKEN_FLAG).toBe(BROKEN_FLAG);
      expect(nav.navMesh.getPolyFlags(ref).flags & LAST_CRACK_FLAG).toBe(0);
    }
    expect(joins()).toBe(false);
    expect(moving.solidAt(block.index, 0, [{ segmentIndex: block.config.segmentIndex, hits: def.entries, returnTick: 900 }])).toBe(false);
    // Returned: both cleared.
    moving.syncFragile(nav, []);
    for (const ref of nav.gated!.keys()) expect(nav.navMesh.getPolyFlags(ref).flags & (BROKEN_FLAG | LAST_CRACK_FLAG)).toBe(0);
    expect(joins()).toBe(true);
    expect(resolved.movingSegments.some((body) => body.fragile !== undefined)).toBe(true);
  });
});
