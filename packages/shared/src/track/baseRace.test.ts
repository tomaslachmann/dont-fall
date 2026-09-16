import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { resolveTrack, trackSpawn, type Track } from "./Track.js";
import { ASSET_PLACEMENT_MODULES, assetFileName, loadAssetLibrary } from "./assetModules.js";
import {
  BASE_RACE_SECTION_STARTS,
  BASE_RACE_TIME_LIMIT_MS,
  BASE_RACE_TRACK,
  BELT_PITCH,
  BELT_PUSHER_ALONG,
  CLIMB_FAN_DS,
  CLIMB_PAD_DS,
  DOOR_RUSH_ROWS,
  MOVING_ROWS,
  SPINNING_SQUARE_DS,
  SWEEPER_SPEEDS,
} from "./baseRace.js";
import { invalidTrackCourseReason, startSegmentIndex } from "./Course.js";
import { MAX_TIME_LIMIT_MS, TICK_RATE_HZ } from "../tuning.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS } from "../simulation/SimInputs.js";

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

describe("the base race (ADR 0078)", () => {
  it("places Assets only — nothing procedural", () => {
    for (const segment of BASE_RACE_TRACK) expect(ASSET_PLACEMENT_MODULES[segment.moduleId], segment.moduleId).toBeDefined();
    for (const segment of BASE_RACE_TRACK) expect(assetFileName(segment.moduleId)).toMatch(/\.glb$/);
  });

  it("is a whole course: a Start, seven Checkpoints in order, a finish, no warnings", () => {
    expect(invalidTrackCourseReason(BASE_RACE_TRACK, library)).toBeUndefined();
    expect(startSegmentIndex(BASE_RACE_TRACK)).toBe(0);

    const resolved = resolveTrack(library, BASE_RACE_TRACK);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.finishZones).toHaveLength(1);
    const orders = BASE_RACE_TRACK.flatMap((segment) => (segment.checkpoint ? [segment.checkpoint.order] : []));
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(resolved.checkpoints).toHaveLength(7);
    // Every Respawn found a floor in front of its gate, further along each time.
    const respawnS = resolved.checkpoints.map((checkpoint) => -checkpoint.respawn.z);
    expect([...respawnS].sort((a, b) => a - b)).toEqual(respawnS);
  });

  it("runs on a clock a Revision may store", () => {
    expect(BASE_RACE_TIME_LIMIT_MS).toBeLessThanOrEqual(MAX_TIME_LIMIT_MS);
  });

  /**
   * The scripted playtest. With every Motion stopped at rest the course is
   * still a course — rest poses are laid out to leave a way through — so a
   * waypoint walker proves the geometry: every gap jumpable, every Spring and
   * fan reaching the tier above, every belt climbable, every Checkpoint
   * passed, the finish reached, and never a Fall. The obstacles' timing is
   * the one thing this cannot judge.
   */
  it("walks end to end with the obstacles at rest — every Checkpoint, the finish, no Fall", () => {
    const still: Track = BASE_RACE_TRACK.map(({ motion: _motion, ...segment }) => segment);
    const sim = new RapierSimulation({ ...resolveTrack(library, still), withDefaultCharacter: false, authoritative: false });
    sim.addCharacter(DEFAULT_CHARACTER_ID, trackSpawn(still, 0, library));

    const waypoints = route();
    let next = 0;
    let pendingJump = false;
    let jumpTicks = 0;
    let sinceProgress = 0;
    let ticks = 0;
    for (; ticks < 300 * TICK_RATE_HZ; ticks += 1) {
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (c.finishTick !== null) break;
      expect(c.fallCount, `fell heading to waypoint ${next} (${JSON.stringify(waypoints[next])})`).toBe(0);
      const wp = waypoints[Math.min(next, waypoints.length - 1)]!;
      const dx = wp.x - c.position.x;
      const dz = -wp.s - c.position.z;
      const distance = Math.hypot(dx, dz);
      if (next < waypoints.length && distance < wp.radius) {
        // A jump waits for the ground: pressed mid-air it would be lost.
        if (wp.jump) pendingJump = true;
        next += 1;
        sinceProgress = 0;
        continue;
      }
      sinceProgress += 1;
      expect(sinceProgress, `stuck heading to waypoint ${next} (${JSON.stringify(wp)})`).toBeLessThan(20 * TICK_RATE_HZ);
      if (pendingJump && c.grounded) {
        jumpTicks = 8;
        pendingJump = false;
      }
      sim.tick({
        [DEFAULT_CHARACTER_ID]: {
          ...IDLE_INPUTS,
          moveDirection: { x: dx / (distance || 1), y: 0, z: dz / (distance || 1) },
          jumpHeld: jumpTicks > 0,
        },
      });
      if (jumpTicks > 0) jumpTicks -= 1;
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.finishTick, "reached the finish").not.toBeNull();
    expect(c.checkpointIndex).toBe(6);
    expect(c.fallCount).toBe(0);
    // Long enough to be a real race even walked straight through with nothing moving.
    expect(ticks / TICK_RATE_HZ).toBeGreaterThan(120);
    sim.dispose();
  }, 120_000);
});

interface Waypoint {
  x: number;
  s: number;
  jump: boolean;
  radius: number;
}

/** A line through the resting course, section by section, read off the same layout constants the course is built from. */
const route = (): Waypoint[] => {
  const S = BASE_RACE_SECTION_STARTS;
  const waypoints: Waypoint[] = [];
  const to = (x: number, s: number, radius = 1): void => void waypoints.push({ x, s, jump: false, radius });
  const jumpFrom = (x: number, edge: number): void => {
    waypoints.push({ x, s: edge - 1.5, jump: false, radius: 0.5 });
    waypoints.push({ x, s: edge - 0.8, jump: true, radius: 0.5 });
  };

  to(0, S.doorRush.s - 4);
  let x = 0;
  for (const { ds, doors } of DOOR_RUSH_ROWS) {
    const door = [...doors].sort((a, b) => Math.abs(a - x) - Math.abs(b - x))[0]!;
    to(door, S.doorRush.s + ds - 2.5, 0.5);
    to(door, S.doorRush.s + ds + 2.5, 0.5);
    x = door;
  }

  // Around the resting bars: right of the first, left of the second.
  SWEEPER_SPEEDS.forEach((_, i) => {
    const c = S.sweepers.s + 6 + 12 * i;
    to(3, c - 6);
    to(3, c);
    to(-3, c + 1);
    to(-3, c + 5);
  });
  to(0, S.checkpoint1.s + 4);

  // Beside the resting balls.
  to(2, S.wreckingBalls.s + 1);
  to(2, S.wreckingBalls.s + 47);
  to(0, S.checkpoint2.s + 6);

  // Row to row, crossing where each pair overlaps at rest.
  let edge = S.movingPlatforms.s;
  let previous = { x: 0, width: 12 };
  for (const row of MOVING_ROWS) {
    const lo = Math.max(previous.x - previous.width / 2, row.x - row.width / 2) + 0.6;
    const hi = Math.min(previous.x + previous.width / 2, row.x + row.width / 2) - 0.6;
    jumpFrom((lo + hi) / 2, edge);
    const center = edge + row.gap + row.depth / 2;
    to((lo + hi) / 2, center, 0.8);
    edge = center + row.depth / 2;
    previous = row;
  }
  jumpFrom(previous.x, edge);
  to(0, S.checkpoint3.s + 4);

  // Corner to corner across the squares, around each resting bar.
  jumpFrom(0, S.spinningSquares.s);
  for (const ds of SPINNING_SQUARE_DS) {
    const c = S.spinningSquares.s + ds;
    to(0, c - 4);
    to(4.2, c);
    to(0, c + 4);
    waypoints.push({ x: 0, s: c + 5.3, jump: true, radius: 0.6 });
  }
  to(0, S.checkpoint4.s + 5);

  // Onto the middle Spring, then jump into the left fan's air.
  const climb = S.climb.s;
  to(0, climb + 1);
  to(0, climb + CLIMB_PAD_DS, 0.5);
  to(0, climb + 21);
  to(0, climb + 27);
  to(-3.5, climb + 27.5);
  waypoints.push({ x: -3.5, s: climb + CLIMB_FAN_DS - 2.6, jump: true, radius: 0.4 });
  to(-3.5, climb + 30);
  to(-3.5, climb + 36);
  to(0, climb + 43);
  to(0, climb + 49);

  // Up the belts, around each resting pair of pusher walls.
  const stepS = 12 * Math.cos(BELT_PITCH);
  for (const i of [1, 3]) {
    const topS = S.beltClimb.s + (i + 0.5) * stepS;
    to(3, topS - 5);
    to(3, topS - BELT_PUSHER_ALONG);
    to(-3, topS);
    to(-3, topS + 5);
  }
  to(0, S.checkpoint6.s + 10);

  // Down the ice between the bumpers.
  to(0.3, S.iceSlide.s + 10.8);
  to(0, S.iceSlide.s + 23.8);
  to(1.5, S.iceSlide.s + 25.8);
  to(1.5, S.iceSlide.s + 33.8);
  to(0, S.checkpoint7.s + 6);

  // Beside the resting hammers, then through the finish.
  to(4, S.hammerAlley.s + 2);
  to(4, S.hammerAlley.s + 58);
  to(0, S.finish.s + 6);
  to(0, S.finish.s + 11);
  return waypoints;
};
