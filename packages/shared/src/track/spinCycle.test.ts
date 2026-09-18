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
  CAROUSEL_DS,
  CAROUSEL_RADIUS,
  FORK_ONE_BAR_DS,
  FORK_ONE_LEFT_DS,
  FORK_ONE_RIGHT_X,
  FORK_THREE_MUD_X,
  FORK_THREE_ICE_X,
  FORK_TWO_BELT_DS,
  FORK_TWO_BOUNCE_DS,
  FORK_TWO_GAP_DS,
  SPIN_CYCLE_SECTION_STARTS,
  SPIN_CYCLE_TRACK,
  SPIN_GATE_DS,
  SWEEPER_GAUNTLET_DS,
  TURNTABLE_AT,
  TURNTABLE_RADIUS,
} from "./spinCycle.js";

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

/** Which arm each fork is walked through. Between them the three routes cover every arm. */
interface Arms {
  one: "left" | "right";
  two: "belt" | "stones" | "bounce";
  three: "mud" | "ice";
}

describe("Spin Cycle", () => {
  it("is a whole course: a Start, seven Checkpoints in order, a finish, no warnings", () => {
    expect(invalidTrackCourseReason(SPIN_CYCLE_TRACK, library)).toBeUndefined();
    expect(startSegmentIndex(SPIN_CYCLE_TRACK)).toBe(0);

    const resolved = resolveTrack(library, SPIN_CYCLE_TRACK);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.finishZones).toHaveLength(1);
    const orders = SPIN_CYCLE_TRACK.flatMap((segment) => (segment.checkpoint ? [segment.checkpoint.order] : []));
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Every Respawn found a floor in front of its gate, further along each time.
    const respawnS = resolved.checkpoints.map((checkpoint) => -checkpoint.respawn.z);
    expect([...respawnS].sort((a, b) => a - b)).toEqual(respawnS);
  });

  /**
   * The scripted playtest, once per set of arms — with every Motion stopped at
   * rest, so what is proven is the geometry: every gap jumpable, every ramp
   * climbable, every Checkpoint passed and the finish reached without a Fall.
   * The obstacles' timing is the one thing this cannot judge.
   */
  const ROUTES: Arms[] = [
    { one: "left", two: "belt", three: "mud" },
    { one: "right", two: "stones", three: "ice" },
    { one: "left", two: "bounce", three: "mud" },
  ];
  for (const arms of ROUTES) {
    it(`walks end to end through ${arms.one} / ${arms.two} / ${arms.three} — every Checkpoint, the finish, no Fall`, () => {
      const waypoints = walkRoute(arms);
      const outcome = walkTrack(library, SPIN_CYCLE_TRACK, waypoints);
      // A Fall first: a Respawn puts the walker back at a Checkpoint, so every
      // later symptom (stuck, unreached waypoints) is that Fall's echo.
      expect(outcome.fallCount, `fell heading to ${JSON.stringify(outcome.fellHeadingTo)}`).toBe(0);
      expect(
        outcome.stuckAt,
        `stuck at waypoint ${outcome.reached}: ${JSON.stringify(outcome.stuckAt)} — standing at ${JSON.stringify(outcome.position)}`,
      ).toBeUndefined();
      expect(outcome.finished, `reached the finish (got to ${JSON.stringify(outcome.position)})`).toBe(true);
      expect(outcome.checkpointIndex).toBe(6);
      // Long enough to be a real race even walked straight through with nothing moving.
      expect(outcome.seconds).toBeGreaterThan(140);
    }, 120_000);
  }
});

/** A line through the resting course, section by section, read off the layout constants the Track is built from. */
const walkRoute = (arms: Arms): Waypoint[] => {
  const S = SPIN_CYCLE_SECTION_STARTS;
  const { to, jumpFrom, waypoints } = route();

  to(0, S.startPlaza.s + 26);

  // Spin gates: round the crossed bars, then through the staggered pair.
  const G = S.spinGates.s;
  const [g0, g1, g2, g3] = SPIN_GATE_DS as [number, number, number, number];
  to(5, G + g0 - 4);
  to(5, G + g0 + 4);
  to(-4, G + g1 - 4);
  to(-4, G + g1 + 4);
  to(5, G + g2 - 4);
  to(5, G + g2 + 4);
  to(3, G + g3 - 5);
  to(3, G + g3 - 1);
  to(-3, G + g3 + 1);
  to(-3, G + g3 + 5);

  // The carousels, crossed on the quarter the bar never reaches.
  const C = S.carousels.s;
  const CROSS_X = -3;
  const reach = Math.sqrt(CAROUSEL_RADIUS ** 2 - CROSS_X ** 2); // how far along a disc still has floor at CROSS_X
  let edge = C;
  for (const ds of CAROUSEL_DS) {
    jumpFrom(CROSS_X, edge);
    to(CROSS_X, C + ds, 1.5);
    edge = C + ds + reach;
  }
  jumpFrom(CROSS_X, edge);
  to(0, S.checkpoint1.s + 4);
  to(0, S.checkpoint1.s + 10);

  // Fork one.
  const F = S.forkOne.s;
  if (arms.one === "left") {
    to(-7.5, F + 16);
    const PASS_X = -8; // inside the arm, clear of the hammers and balls hung on its middle
    for (const [i, ds] of FORK_ONE_LEFT_DS.entries()) {
      to(PASS_X, F + ds, 1.2);
      if (i < FORK_ONE_LEFT_DS.length - 1) jumpFrom(PASS_X, F + ds + 4.5);
    }
    to(-6, F + 78);
  } else {
    to(6, F + 16);
    to(FORK_ONE_RIGHT_X, F + 22);
    to(FORK_ONE_RIGHT_X, F + 30); // up the ramp
    for (const [i, ds] of FORK_ONE_BAR_DS.entries()) {
      // The bars alternate which side of the catwalk they leave open.
      to(FORK_ONE_RIGHT_X + (i % 2 === 0 ? -3.2 : 3.2), F + ds, 1.2);
    }
    to(FORK_ONE_RIGHT_X, F + 77);
    to(FORK_ONE_RIGHT_X, F + 82); // off the end, six metres down onto the rejoin deck
  }
  to(0, F + 90);
  to(0, S.checkpoint2.s + 4);
  to(0, S.checkpoint2.s + 10);

  // Turntables: straight over the middle of each disc, jumping every gap.
  const T = S.turntables.s;
  let turnEdge = T;
  for (const { x, ds } of TURNTABLE_AT) {
    jumpFrom(x, turnEdge);
    to(x, T + ds, 1.2);
    turnEdge = T + ds + TURNTABLE_RADIUS;
  }
  jumpFrom(0, turnEdge);

  // Hammer bridge: past the hung obstacles on their right.
  const H = S.hammerBridge.s;
  to(4, H + 2);
  to(4, H + 58);
  to(0, S.checkpoint3.s + 4);
  to(0, S.checkpoint3.s + 10);

  // Fork two.
  const K = S.forkTwo.s;
  if (arms.two === "belt") {
    to(-15, K + 12);
    for (const ds of FORK_TWO_BELT_DS) to(-15, K + ds, 1.2);
    to(-15, K + 85.5);
  } else if (arms.two === "stones") {
    to(0, K + 12);
    for (const [i, ds] of FORK_TWO_GAP_DS.entries()) {
      to(0, K + ds, 1);
      if (i < FORK_TWO_GAP_DS.length - 1) jumpFrom(0, K + ds + 3);
    }
    jumpFrom(0, K + FORK_TWO_GAP_DS[FORK_TWO_GAP_DS.length - 1]! + 3);
    to(0, K + 85.5);
  } else {
    to(15, K + 12);
    for (const ds of FORK_TWO_BOUNCE_DS) to(15, K + ds, 1.5);
    to(15, K + 85.5);
  }
  to(0, K + 91);
  to(0, S.checkpoint4.s + 4);
  to(0, S.checkpoint4.s + 10);

  // The sweeper gauntlet: the open strip is on the other side each deck.
  const W = S.sweeperGauntlet.s;
  for (const [i, ds] of SWEEPER_GAUNTLET_DS.entries()) {
    const open = i % 2 === 0 ? -4.5 : 4.5;
    to(open, W + ds - 4);
    to(open, W + ds + 4);
  }
  to(0, S.checkpoint5.s + 4);
  to(0, S.checkpoint5.s + 10);

  // The ascent: up the left of both ramps, then across for the last landing's bar.
  const A = S.theAscent.s;
  to(-4, A + 6);
  to(-4, A + 22);
  to(-4, A + 30);
  to(-4, A + 46);
  to(4, A + 51);
  to(4, A + 58);
  to(0, S.checkpoint6.s + 4);
  to(0, S.checkpoint6.s + 10);

  // Fork three.
  const Y = S.forkThree.s;
  if (arms.three === "mud") {
    to(-7, Y + 14);
    to(FORK_THREE_MUD_X, Y + 22);
    to(FORK_THREE_MUD_X, Y + 50);
  } else {
    // The ice's two bars leave their open strip on opposite sides, so the
    // crossing happens where the decks meet — on no grip at all.
    to(7, Y + 14);
    to(FORK_THREE_ICE_X - 1.8, Y + 22, 1.5);
    to(FORK_THREE_ICE_X - 1.8, Y + 33, 1.5);
    to(FORK_THREE_ICE_X + 1.8, Y + 40, 1.5);
    to(FORK_THREE_ICE_X + 1.8, Y + 50, 1.5);
  }
  to(0, Y + 62);
  to(0, Y + 74);
  to(0, S.checkpoint7.s + 4);
  to(0, S.checkpoint7.s + 10);

  // The last carousel, and through the sign.
  const V = S.finalCarousel.s;
  jumpFrom(CROSS_X, V);
  to(CROSS_X, V + 10, 1.5);
  jumpFrom(CROSS_X, V + 10 + reach);
  to(0, S.finish.s + 6);
  to(0, S.finish.s + 11);
  return waypoints;
};
