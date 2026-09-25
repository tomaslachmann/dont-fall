import { beforeAll, describe, expect, it } from "vitest";
import { loadTestLibrary } from "../../bot/sectionHarness.js";
import { at, disc, onTop, spin, type Extra } from "../../track/authoring.js";
import type { Module } from "../../track/Module.js";
import { resolveTrack } from "../../track/resolveTrack.js";
import type { Track } from "../../track/Track.js";
import { CAPSULE_BOTTOM_OFFSET, GROUND_STICK_SPEED } from "../../tuning/character.js";
import { RapierSimulation } from "../RapierSimulation.js";
import { IDLE_INPUTS } from "../SimInputs.js";

/*
 * M17 ticket 07k: a Character wedged in a Moving Segment. Found by the Bots on
 * `transfers.test.ts`'s T1 (two turntables): `bot-9`, standing still on the
 * second turntable while the spin carried it, was landed on by `bot-2` coming
 * down from a jump. The Ride's carry sweep — which ignores the carrier's own
 * colliders, so riding never collides with what it rides — met bot-2's capsule
 * from below and slid the rider down its underside: 0.18 m into the disc in
 * one tick, 0.23 more two ticks later. Inside the disc's hull pieces the
 * capsule saw only their side faces at no distance, was never grounded
 * again, never moved again, and `velocity.y` grew to −843 over 1300 ticks.
 *
 * The same Track, the same disc, the same two positions — no Bot.
 */

const TOP = 4;
const lane = (s: number, extra: Extra = {}) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2, ...extra });
/** `transfers.test.ts`'s T1: a lane, a turntable, another turning the other way, a lane beyond. */
const T1: Track = [
  lane(6, { start: true }),
  lane(18),
  ...disc(0, TOP, 28, 4, { motion: spin(0.8) }),
  ...disc(1.5, TOP, 38, 4, { motion: spin(-0.9) }),
  lane(50),
  at("kaykit_arch_wide_yellow", 0, TOP, 54, { scale: 2, checkpoint: { order: 1 } }),
];
/** The capsule centre of a Character standing on the disc. */
const STANDING_Y = TOP + CAPSULE_BOTTOM_OFFSET;
/** Where bot-9 stood at Tick 486, riding the second turntable. */
const RIDER = { x: 1.242, y: STANDING_Y + 0.01, z: -35.17 };
/** Where bot-2 was at Tick 486, mid-jump toward the disc; its height is what times the landing. */
const JUMPER = { x: 0.425, z: -34.506 };
const JUMPER_INPUT = { ...IDLE_INPUTS, moveDirection: { x: -0.05, y: 0, z: -0.9987 } };

let library: Record<string, Module>;
beforeAll(async () => {
  library = await loadTestLibrary();
}, 60_000);

const simAt = (tick: number): RapierSimulation => {
  const sim = new RapierSimulation({ ...resolveTrack(library, T1), withDefaultCharacter: false, motionClock: 0 });
  sim.syncTick(tick);
  return sim;
};

describe("a rider landed on by another Character (M17 ticket 07k)", () => {
  // Two jumper heights that wedged the rider before the fix (min y 4.397 and
  // 4.299 against a standing 4.85, never grounded again, velocity.y −24 and
  // −31 after 40 ticks); 6.4 and 6.5 shoved it down 0.3 and 0.1 and it recovered.
  for (const height of [6.6, 6.7]) {
    it(`is never taken below its carrier (jumper from ${height})`, () => {
      const sim = simAt(485);
      sim.addCharacter("rider", RIDER);
      sim.addCharacter("jumper", { ...JUMPER, y: height });
      let lowest = Infinity;
      for (let n = 0; n < 40; n += 1) {
        sim.tick({ rider: IDLE_INPUTS, jumper: JUMPER_INPUT }, "RUNNING");
        lowest = Math.min(lowest, sim.snapshot().characters.rider!.position.y);
      }
      const rider = sim.snapshot().characters.rider!;
      sim.dispose();
      // A hair of bevel at a seam is fine; a capsule inside the deck is not.
      expect(lowest).toBeGreaterThan(STANDING_Y - 0.1);
      expect(rider.grounded).toBe(true);
      expect(rider.velocity.y).toBeGreaterThanOrEqual(-GROUND_STICK_SPEED - 1e-6);
      expect(rider.fallCount).toBe(0);
    });
  }
});

describe("a Character inside a Moving Segment (M17 ticket 07k)", () => {
  it("is lifted out onto it on the next tick, and lands there", () => {
    // bot-9's frozen pose from Tick 494 on: 0.4 m down into the disc, 0.68 m
    // in from its rim. A correction can put a predicted capsule there too.
    const sim = simAt(494);
    sim.addCharacter("me", RIDER);
    const base = sim.snapshot().characters.me!;
    sim.reconcileCharacter("me", { ...base, position: { x: 0.679, y: 4.452, z: -35.649 }, velocity: { x: 0, y: -2.733, z: 0 }, grounded: false });
    sim.syncTick(494); // as the client's correction does: the move reaches the collider before the next sweep
    sim.tick({ me: IDLE_INPUTS }, "RUNNING");
    const freed = sim.snapshot().characters.me!;
    expect(freed.grounded).toBe(true);
    expect(freed.position.y).toBeCloseTo(STANDING_Y, 1);
    expect(freed.velocity.y).toBeGreaterThanOrEqual(-GROUND_STICK_SPEED - 1e-6);
    // And it rides on from there.
    const before = { ...freed.position };
    for (let n = 0; n < 30; n += 1) sim.tick({ me: IDLE_INPUTS }, "RUNNING");
    const later = sim.snapshot().characters.me!;
    sim.dispose();
    expect(later.grounded).toBe(true);
    expect(later.fallCount).toBe(0);
    expect(Math.hypot(later.position.x - before.x, later.position.z - before.z)).toBeGreaterThan(1);
  });
});
