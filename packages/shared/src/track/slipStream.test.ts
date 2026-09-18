import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import { loadAssetLibrary } from "./assetModules.js";
import { invalidTrackCourseReason, startSegmentIndex } from "./Course.js";
import { initPhysics } from "../simulation/RapierSimulation.js";
import { route, walkTrack, type Waypoint } from "./walkTrack.js";
import {
  BOUNCE_FIELD_DS,
  FINAL_RUN_DS,
  FORK_ONE_BAR_DS,
  FORK_ONE_ICE_DS,
  FORK_ONE_ICE_X,
  FORK_ONE_LADDER_X,
  FORK_ONE_PAD_DS,
  FORK_THREE_BELT_DS,
  FORK_THREE_BELT_X,
  FORK_THREE_GAP_DS,
  FORK_THREE_GAP_X,
  FORK_TWO_ARM_X,
  FORK_TWO_MUD_DS,
  FORK_TWO_STONE_DS,
  FORK_TWO_TO,
  FORK_TWO_UPDRAFT_DS,
  ICE_RIVER_PITCH,
  LANE,
  LAUNCH_GAP_DS,
  SLALOM_DS,
  SLIP_STREAM_SECTION_STARTS,
  SLIP_STREAM_TRACK,
  SPRING_FAN_DS,
  SPRING_PAD_DS,
} from "./slipStream.js";

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

/** Which arm each fork is walked through. Between the three routes every arm is walked once. */
interface Arms {
  one: "ice" | "ladder";
  two: "updraft" | "stones" | "mud";
  three: "belt" | "gaps";
}

describe("Slip Stream", () => {
  it("is a whole course: a Start, seven Checkpoints in order, a finish, no warnings", () => {
    expect(invalidTrackCourseReason(SLIP_STREAM_TRACK, library)).toBeUndefined();
    expect(startSegmentIndex(SLIP_STREAM_TRACK)).toBe(0);

    const resolved = resolveTrack(library, SLIP_STREAM_TRACK);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.finishZones).toHaveLength(1);
    const orders = SLIP_STREAM_TRACK.flatMap((segment) => (segment.checkpoint ? [segment.checkpoint.order] : []));
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const respawnS = resolved.checkpoints.map((checkpoint) => -checkpoint.respawn.z);
    expect([...respawnS].sort((a, b) => a - b)).toEqual(respawnS);
  });

  const ROUTES: Arms[] = [
    { one: "ice", two: "updraft", three: "belt" },
    { one: "ladder", two: "stones", three: "gaps" },
    { one: "ice", two: "mud", three: "belt" },
  ];
  for (const arms of ROUTES) {
    it(`walks end to end through ${arms.one} / ${arms.two} / ${arms.three} — every Checkpoint, the finish, no Fall`, () => {
      const outcome = walkTrack(library, SLIP_STREAM_TRACK, walkRoute(arms));
      expect(outcome.fallCount, `fell heading to ${JSON.stringify(outcome.fellHeadingTo)}`).toBe(0);
      expect(
        outcome.stuckAt,
        `stuck at waypoint ${outcome.reached}: ${JSON.stringify(outcome.stuckAt)} — standing at ${JSON.stringify(outcome.position)}`,
      ).toBeUndefined();
      expect(outcome.finished, `reached the finish (got to ${JSON.stringify(outcome.position)})`).toBe(true);
      expect(outcome.checkpointIndex).toBe(6);
      expect(outcome.seconds).toBeGreaterThan(140);
    }, 120_000);
  }
});

/** A line through the resting course, section by section, read off the layout constants the Track is built from. */
const walkRoute = (arms: Arms): Waypoint[] => {
  const S = SLIP_STREAM_SECTION_STARTS;
  const { to, jumpFrom, waypoints } = route();

  to(0, S.startYard.s + 26);

  // Cross belts: past each parked wall on its open side, holding a line against the belt.
  const B = S.crossBelts.s;
  to(3, B + 2);
  to(3, B + 11);
  to(-3, B + 14);
  to(-3, B + 35);
  to(3, B + 38);
  to(3, B + 46);

  // The Spring climb: onto the middle pad, then a jump into the left fan's air.
  const P = S.springSteps.s;
  to(0, P + 1);
  to(0, P + SPRING_PAD_DS, 0.5);
  to(0, P + 21);
  to(0, P + 27);
  to(-3.5, P + 27.5);
  waypoints.push({ x: -3.5, s: P + SPRING_FAN_DS - 2.6, jump: true, radius: 0.4 });
  to(-3.5, P + 30);
  to(-3.5, P + 36);
  to(0, P + 43);
  to(0, P + 49);
  to(0, S.checkpoint1.s + 4);
  to(0, S.checkpoint1.s + 10);

  // Fork one.
  const F = S.forkOne.s;
  if (arms.one === "ice") {
    to(-7.5, F + 16);
    // Down the lane the bumpers leave between them — on ice, the line is the whole job.
    to(FORK_ONE_ICE_X, F + FORK_ONE_ICE_DS[0]!, 1.5);
    to(FORK_ONE_ICE_X, F + FORK_ONE_ICE_DS[FORK_ONE_ICE_DS.length - 1]! + 2, 1.5);
    to(-6, F + 78);
  } else {
    to(7, F + 16);
    to(FORK_ONE_LADDER_X, F + 22);
    to(FORK_ONE_LADDER_X, F + FORK_ONE_PAD_DS, 0.5);
    for (const [i, ds] of FORK_ONE_BAR_DS.entries()) {
      to(FORK_ONE_LADDER_X + (i % 2 === 0 ? -2.5 : 2.5), F + ds, 1.2);
    }
    to(FORK_ONE_LADDER_X, F + 79); // off the end, six metres down onto the rejoin deck
  }
  to(0, F + 90);
  to(0, S.checkpoint2.s + 4);
  to(0, S.checkpoint2.s + 10);

  // The bounce field: past each deck's obstacle, jumping every gap.
  // Each deck's obstacle is on a different side, so the crossing happens on
  // the deck — never in the air over a gap, and never onto a landing that is
  // about to throw the jump back.
  const V = S.bounceField.s;
  to(-4, V + 4);
  to(-4, V + 10, 1.5);
  jumpFrom(-4, V + BOUNCE_FIELD_DS[0]! + LANE / 2);
  to(-4, V + 16, 1.5);
  to(3, V + 18, 1.5);
  to(3, V + 24, 1.5);
  jumpFrom(3, V + BOUNCE_FIELD_DS[1]! + LANE / 2);
  to(3, V + 38, 1.5);
  jumpFrom(3, V + BOUNCE_FIELD_DS[2]! + LANE / 2);
  to(3, V + 44, 1.5);
  to(-3, V + 46, 1.5);
  to(-3, V + 53, 1.5);

  // The slalom: a zig-zag between the parked walls.
  const L = S.slalom.s;
  for (const [i, ds] of SLALOM_DS.entries()) {
    const side = i % 2 === 0 ? 1 : -1;
    to(-side * 2.5, L + ds - 3);
    to(side * 2.5, L + ds + 3);
  }
  to(0, S.checkpoint3.s + 4);
  to(0, S.checkpoint3.s + 10);

  // Fork two.
  const T = S.forkTwo.s;
  const [ax, bx, cx] = FORK_TWO_ARM_X;
  if (arms.two === "updraft") {
    to(ax, T + 12);
    for (const [i, ds] of FORK_TWO_UPDRAFT_DS.entries()) {
      to(ax, T + ds, 1.2);
      if (i < FORK_TWO_UPDRAFT_DS.length - 1) jumpFrom(ax, T + ds + 4.5);
    }
  } else if (arms.two === "stones") {
    to(bx, T + 12);
    for (const [i, ds] of FORK_TWO_STONE_DS.entries()) {
      // The hammers hang on the centre line, so the stones are crossed off it.
      to(bx + 2.6, T + ds, 1.2);
      if (i < FORK_TWO_STONE_DS.length - 1) jumpFrom(bx + 2.6, T + ds + 4);
    }
  } else {
    to(cx, T + 12);
    // Deck by deck: mud is the slowest floor in the game, and sixty metres of
    // it in one waypoint reads as a stall rather than a crawl.
    for (const ds of FORK_TWO_MUD_DS) to(cx, T + ds, 1.5);
  }
  // Straight on until the rejoin deck is underfoot, and only then across it:
  // an arm's edge is still an edge right up to where the rejoin starts.
  to(arms.two === "updraft" ? ax : arms.two === "stones" ? bx : cx, T + FORK_TWO_TO + 4);
  to(0, T + 88);
  to(0, S.checkpoint4.s + 4);
  to(0, S.checkpoint4.s + 10);

  // The ice river, straight down the middle the bumpers leave open.
  const R = S.iceRiver.s;
  const step = LANE * Math.cos(ICE_RIVER_PITCH);
  to(0, R + step, 1.5);
  to(0, R + 5 * step - 1, 1.5);
  to(0, S.checkpoint5.s + 4);
  to(0, S.checkpoint5.s + 10);

  // Launch gaps: over each pad, which fires whether you meant it to or not.
  const G = S.launchGap.s;
  for (const [i, ds] of LAUNCH_GAP_DS.entries()) {
    to(0, G + ds, 1.2);
    if (i < LAUNCH_GAP_DS.length - 1) to(0, G + ds + 3, 0.5);
  }
  to(0, G + 53);

  // Fork three.
  const Y = S.forkThree.s;
  if (arms.three === "belt") {
    to(-7, Y + 14);
    to(FORK_THREE_BELT_X - 1, Y + FORK_THREE_BELT_DS[0]!, 1.2);
    to(FORK_THREE_BELT_X - 1, Y + FORK_THREE_BELT_DS[FORK_THREE_BELT_DS.length - 1]! + 3, 1.2);
    to(-6, Y + 60);
  } else {
    to(7, Y + 14);
    for (const [i, ds] of FORK_THREE_GAP_DS.entries()) {
      to(FORK_THREE_GAP_X - 1, Y + ds, 1.2);
      if (i < FORK_THREE_GAP_DS.length - 1) jumpFrom(FORK_THREE_GAP_X - 1, Y + ds + 3);
    }
    to(8, Y + 60);
  }
  to(0, Y + 70);
  to(0, S.checkpoint6.s + 4);
  to(0, S.checkpoint6.s + 10);

  // The last straight, past the wrecking balls on their right.
  const N = S.finalRun.s;
  to(4, N + 2);
  to(4, N + FINAL_RUN_DS[FINAL_RUN_DS.length - 1]! + 4);
  to(0, S.checkpoint7.s + 4);
  to(0, S.checkpoint7.s + 10);
  to(0, S.finish.s + 6);
  to(0, S.finish.s + 11);
  return waypoints;
};
