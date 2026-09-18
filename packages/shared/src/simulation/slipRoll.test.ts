import { describe, expect, it } from "vitest";
import { ICE_LANDING_KNOCKDOWN_CHANCE } from "../tuning/surfaces.js";
import { slipRoll } from "./slipRoll.js";

describe("slipRoll (ADR 0092)", () => {
  it("is the same number for the same Character and Tick — the whole reason a slip can be predicted", () => {
    // The client replays a Tick the server already ran; both must draw this
    // identically or every coin flip becomes a correction.
    expect(slipRoll("player-a", 1234)).toBe(slipRoll("player-a", 1234));
    expect(slipRoll("player-a", 1234)).not.toBe(slipRoll("player-b", 1234));
    expect(slipRoll("player-a", 1234)).not.toBe(slipRoll("player-a", 1235));
  });

  it("stays inside [0, 1)", () => {
    for (let tick = 0; tick < 2000; tick += 1) {
      const roll = slipRoll("player-a", tick);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
    }
  });

  it("does not alternate across neighbouring Ticks — a landing is a coin flip, not a pattern", () => {
    // Without the finalizer, consecutive ticks land on near-consecutive
    // outputs and "50%" reads as strict alternation on the ice.
    let flips = 0;
    let previous = slipRoll("player-a", 0) < ICE_LANDING_KNOCKDOWN_CHANCE;
    for (let tick = 1; tick < 500; tick += 1) {
      const now = slipRoll("player-a", tick) < ICE_LANDING_KNOCKDOWN_CHANCE;
      if (now !== previous) flips += 1;
      previous = now;
    }
    // A fair independent coin flips on ~half its steps; strict alternation
    // would flip on all of them.
    expect(flips).toBeGreaterThan(180);
    expect(flips).toBeLessThan(320);
  });

  it("comes up under the ice chance about half the time, across ids and Ticks", () => {
    let slipped = 0;
    const draws = 4000;
    for (let i = 0; i < draws; i += 1) {
      if (slipRoll(`player-${i % 7}`, i) < ICE_LANDING_KNOCKDOWN_CHANCE) slipped += 1;
    }
    const rate = slipped / draws;
    expect(rate).toBeGreaterThan(ICE_LANDING_KNOCKDOWN_CHANCE - 0.05);
    expect(rate).toBeLessThan(ICE_LANDING_KNOCKDOWN_CHANCE + 0.05);
  });
});
