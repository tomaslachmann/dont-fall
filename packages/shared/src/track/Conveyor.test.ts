import { describe, expect, it } from "vitest";
import {
  CONVEYOR_PRESETS,
  CONVEYOR_SPEEDS,
  conveyorWorldVelocity,
  DEPRECATED_MODULE_IDS,
  isSegmentConveyor,
} from "./Conveyor.js";

describe("conveyorWorldVelocity (ADR 0064)", () => {
  it("runs module-forward (local -Z, toward the exit) at angle 0", () => {
    expect(conveyorWorldVelocity({ preset: "medium", angle: 0 }, 0)).toEqual({ x: 0, y: 0, z: -4 });
  });

  it("composes the Segment's own yaw additively with the local angle", () => {
    const v = conveyorWorldVelocity({ preset: "slow", angle: Math.PI / 2 }, Math.PI / 2);
    // π/2 + π/2 = π: module forward spun halfway around is world +Z at slow speed.
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBe(0);
    expect(v.z).toBeCloseTo(2, 10);
  });

  it("is always horizontal — pitch/roll never tilt a belt", () => {
    // There is deliberately no pitch/roll parameter at all: the signature
    // itself is the yaw-only guarantee. A sideways angle still has zero Y.
    expect(conveyorWorldVelocity({ preset: "fast", angle: Math.PI / 4 }, 0).y).toBe(0);
  });

  it("fast beats WALK_SPEED so an opposing belt can hold or push back", () => {
    expect(CONVEYOR_SPEEDS.fast).toBeGreaterThan(6);
    expect(CONVEYOR_PRESETS).toEqual(["slow", "medium", "fast"]);
  });
});

describe("isSegmentConveyor", () => {
  it("accepts a known preset with a finite angle", () => {
    expect(isSegmentConveyor({ preset: "medium", angle: 1.2 })).toBe(true);
  });

  it("rejects unknown presets, non-finite angles and non-objects", () => {
    expect(isSegmentConveyor({ preset: "turbo", angle: 0 })).toBe(false);
    expect(isSegmentConveyor({ preset: "fast", angle: NaN })).toBe(false);
    expect(isSegmentConveyor({ preset: "fast", angle: Infinity })).toBe(false);
    expect(isSegmentConveyor({ preset: "fast" })).toBe(false);
    expect(isSegmentConveyor({ angle: 0 })).toBe(false);
    expect(isSegmentConveyor(null)).toBe(false);
    expect(isSegmentConveyor("fast")).toBe(false);
  });

  it("rejects presets that only match Object.prototype properties", () => {
    expect(isSegmentConveyor({ preset: "toString", angle: 0 })).toBe(false);
    expect(isSegmentConveyor({ preset: "constructor", angle: 0 })).toBe(false);
  });
});

describe("DEPRECATED_MODULE_IDS (ADR 0064/0066/0067/0068/0075)", () => {
  it("names exactly the retired Modules — the two pads, ice and mud, the course blocks, and the updraft last of all", () => {
    expect([...DEPRECATED_MODULE_IDS].sort()).toEqual([
      "checkpoint-end-props",
      "checkpoint-spinner",
      "finish",
      "ice",
      "mud",
      "sandbox",
      "slow-pad",
      "speed-pad",
      "start",
      "updraft",
    ]);
  });
});
