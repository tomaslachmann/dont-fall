import { TICK_MS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { survivalTimesMs } from "./career.js";

describe("survivalTimesMs (ADR 0110)", () => {
  it("runs from the Round's start to each elimination, and to the end for a survivor", () => {
    expect(
      survivalTimesMs(
        { out: { eliminatedTick: 130 }, survivor: { eliminatedTick: null } },
        100,
        400,
      ),
    ).toEqual({ out: Math.round(30 * TICK_MS), survivor: Math.round(300 * TICK_MS) });
  });
});
