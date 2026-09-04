import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_LIMIT_MS, TICK_MS, TICK_RATE_HZ } from "../tuning.js";
import { roundTimeLeftMs } from "./roundClock.js";

describe("roundTimeLeftMs", () => {
  it("is the whole Time Limit before a single Tick has run", () => {
    expect(roundTimeLeftMs(60_000, 0)).toBe(60_000);
  });

  it("counts down one Tick's worth of milliseconds per Tick", () => {
    expect(roundTimeLeftMs(60_000, 1)).toBe(60_000 - TICK_MS);
    expect(roundTimeLeftMs(60_000, TICK_RATE_HZ)).toBe(59_000); // one second of Ticks
  });

  it("reaches exactly zero at the Tick the Time Limit is up", () => {
    expect(roundTimeLeftMs(60_000, 60 * TICK_RATE_HZ)).toBe(0);
  });

  it("never goes negative — a Round the server keeps ticking past sits at zero", () => {
    // Reaching zero does not end anything yet (M4 ticket 05 does), so the
    // clock has to keep being asked long after it has run out.
    expect(roundTimeLeftMs(60_000, 60 * TICK_RATE_HZ + 500)).toBe(0);
  });

  it("never exceeds the Time Limit, even given a negative elapsed count", () => {
    expect(roundTimeLeftMs(60_000, -10)).toBe(60_000);
  });

  it("counts the default Time Limit down over three minutes", () => {
    expect(DEFAULT_TIME_LIMIT_MS).toBe(180_000);
    expect(roundTimeLeftMs(DEFAULT_TIME_LIMIT_MS, 90 * TICK_RATE_HZ)).toBe(90_000);
  });
});
