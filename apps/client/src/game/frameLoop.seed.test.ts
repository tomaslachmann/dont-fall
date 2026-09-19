import { DEFAULT_CHARACTER_ID, IDLE_INPUTS, RapierSimulation, TICK_MS, initPhysics } from "@dont-fall/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { PredictionLoop } from "../net/predictionLoop.js";
import { seedPredictionTick } from "./frameLoop.js";

beforeAll(async () => {
  await initPhysics();
});

const newLoop = (): PredictionLoop => {
  const sim = new RapierSimulation({
    statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } }],
    withDefaultCharacter: false,
    authoritative: false,
  });
  sim.addCharacter(DEFAULT_CHARACTER_ID, { x: 0, y: 1.2, z: 0 });
  return new PredictionLoop(sim, DEFAULT_CHARACTER_ID);
};

/**
 * ADR 0109 made `step` advance the tick by a frame's whole elapsed time, a
 * clamped stall included, so the frame that seeds the tick must not count
 * that time a second time. The game booting, or a Round's Track swapping in,
 * while the tab is hidden makes the seeding frame as long as the tab was.
 */
describe("seedPredictionTick — the seeding frame counts its time once (ADR 0027, ADR 0109)", () => {
  /** The server's Tick at client time `ms`, as a ready interpolator estimates it: Tick 5000 at 0. */
  const serverInterp = { ready: true, estimatedServerTick: (ms: number): number => 5000 + ms / TICK_MS };
  /** An 80 ms round trip, which the seed turns into a lead of `ceil(40 / TICK_MS) + 1` = 3 ticks. */
  const timeSync = { ready: true, rttMs: 80 };

  it.each([1000 / 60, 300, 10_000])("leads the server by the seeded lead after a %i ms seeding frame", (elapsedMs) => {
    const loop = newLoop();
    const now = 60_000;
    // The frame loop's own order: seed, then step the frame's whole elapsed time.
    seedPredictionTick(loop, timeSync, serverInterp, now, elapsedMs);
    loop.step(IDLE_INPUTS, elapsedMs);
    expect(loop.isSeeded).toBe(true);
    expect(Math.abs(loop.tick - (serverInterp.estimatedServerTick(now) + 3))).toBeLessThanOrEqual(1);
  });
});
