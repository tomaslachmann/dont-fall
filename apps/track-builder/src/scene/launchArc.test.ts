import { describe, expect, it } from "vitest";
import { GRAVITY_Y, LAUNCH_HEIGHT_PRESETS, type LaunchDef, type Segment } from "@dont-fall/shared";
import { launchArcOf } from "./launchArc.js";

const DEF: LaunchDef = {
  trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1.1, z: 0.5 } },
  height: LAUNCH_HEIGHT_PRESETS.medium,
};
const at = (segment: Partial<Segment> = {}): Segment => ({
  moduleId: "spring",
  position: { x: 0, y: 0, z: 0 },
  rotation: 0,
  ...segment,
});

describe("launchArcOf (ADR 0069)", () => {
  it("apexes exactly the authored height above its launch point — the arc can't promise a jump the Track won't make", () => {
    const arc = launchArcOf(at(), DEF);
    expect(arc.height).toBeCloseTo(DEF.height, 6);
    expect(arc.apex.y - arc.points[0]!.y).toBeCloseTo(DEF.height, 6);
  });

  it("uses the Segment's own height when it overrides", () => {
    const arc = launchArcOf(at({ launch: { height: 12 } }), DEF);
    expect(arc.height).toBeCloseTo(12, 6);
  });

  it("starts and ends level, and rises in between", () => {
    const arc = launchArcOf(at(), DEF);
    expect(arc.points.at(-1)!.y).toBeCloseTo(arc.points[0]!.y, 6);
    expect(arc.apex.y).toBeGreaterThan(arc.points[0]!.y);
    for (const p of arc.points) expect(p.y).toBeLessThanOrEqual(arc.apex.y + 1e-9);
  });

  it("goes straight up when the Spring stands up, and travels when it is tilted", () => {
    const upright = launchArcOf(at(), DEF);
    expect(Math.hypot(upright.apex.x - upright.points[0]!.x, upright.apex.z - upright.points[0]!.z)).toBeCloseTo(0, 6);

    const tilted = launchArcOf(at({ pitch: Math.PI / 6 }), DEF);
    const travel = Math.hypot(
      tilted.points.at(-1)!.x - tilted.points[0]!.x,
      tilted.points.at(-1)!.z - tilted.points[0]!.z,
    );
    expect(travel).toBeGreaterThan(1);
    // A tilted Spring trades climb for distance: it cannot also apex higher.
    expect(tilted.height).toBeLessThan(upright.height);
  });

  it("starts where the Spring's own trigger is, following the Segment", () => {
    const moved = launchArcOf(at({ position: { x: 4, y: 2, z: -7 } }), DEF);
    expect(moved.points[0]!).toEqual({ x: 4, y: 3, z: -7 });
  });

  it("scales its launch point with the Segment but not its throw", () => {
    const big = launchArcOf(at({ scale: 2 }), DEF);
    expect(big.points[0]!.y).toBeCloseTo(2, 6);
    expect(big.height).toBeCloseTo(DEF.height, 6);
  });

  it("draws nothing to fly when a Spring is tipped past level", () => {
    const upended = launchArcOf(at({ pitch: Math.PI }), DEF);
    expect(upended.points.every((p) => p.y === upended.points[0]!.y)).toBe(true);
    expect(GRAVITY_Y).toBeLessThan(0); // the arc's whole premise
  });
});
