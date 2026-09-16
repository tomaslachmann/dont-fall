import { MOVING_SEGMENT_RAGDOLL_SPEED, MOVING_SEGMENT_STAGGER_SPEED, type Module } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  cycleFraction,
  describeSlide,
  describeSpin,
  describeSwing,
  footprintCorners,
  motionPath,
  sampleCycle,
  secondsForFraction,
  speedOutcome,
  topSpeedAt,
} from "./motionPreview.js";

// A 2 × 1 × 6 bar resting on y = 0, centred on the origin.
const BAR: Module = {
  id: "bar",
  statics: [],
  sockets: [],
  footprint: { bounds: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 1, y: 0.5, z: 3 } }, clearance: 0.5 },
};
const CORNERS = footprintCorners(BAR);
const Y = { x: 0, y: 1, z: 0 };

describe("speeds and outcomes", () => {
  it("finds the fastest corner of a spin — the one farthest from its pivot", () => {
    // 2 rad/s about the centre: the far corners sit √(1² + 3²) ≈ 3.16 out.
    expect(topSpeedAt({ spin: { axis: Y, pivot: { x: 0, y: 0.5, z: 0 }, speed: 2 } }, 1, CORNERS)).toBeCloseTo(2 * Math.hypot(1, 3), 1);
  });

  it("maps speed through the simulation's own thresholds", () => {
    expect(speedOutcome(MOVING_SEGMENT_STAGGER_SPEED - 0.1)).toBe("none");
    expect(speedOutcome(MOVING_SEGMENT_STAGGER_SPEED + 0.1)).toBe("stagger");
    expect(speedOutcome(MOVING_SEGMENT_RAGDOLL_SPEED + 0.1)).toBe("ragdoll");
  });
});

describe("sampleCycle", () => {
  const slide = { offset: { x: 8, y: 0, z: 0 }, period: 4, easing: "easeInOut" as const, pause: 0.5, phase: 0.3 };

  it("starts at the rest end whatever the phase, and marks the holds", () => {
    const samples = sampleCycle({ slide }, CORNERS);
    expect(samples[0]!.position).toBe(0);
    const atFarHold = samples.find((s) => s.t >= 1.6 && s.t < 2)!;
    expect(atFarHold.holding).toBe(true);
    expect(atFarHold.position).toBe(1);
    expect(atFarHold.speed).toBeCloseTo(0, 5);
  });

  it("is fastest mid-travel under easeInOut", () => {
    const samples = sampleCycle({ slide }, CORNERS);
    const fastest = samples.reduce((a, b) => (b.speed > a.speed ? b : a));
    // Travel out lasts 1.5 s; its middle is at 0.75 s.
    expect(fastest.t).toBeGreaterThan(0.5);
    expect(fastest.t).toBeLessThan(1);
  });
});

describe("the playhead", () => {
  const timing = { period: 4, easing: "linear" as const, phase: 0.25 };

  it("puts 'now' at the clock time plus the phase", () => {
    expect(cycleFraction(timing, 0)).toBeCloseTo(0.25);
    expect(cycleFraction(timing, 3)).toBeCloseTo(0);
  });

  it("scrubs back to the clock time nearest now for a picked fraction", () => {
    const t = secondsForFraction(timing, 0.5, 9);
    expect(cycleFraction(timing, t)).toBeCloseTo(0.5);
    expect(Math.abs(t - 9)).toBeLessThanOrEqual(4);
  });
});

describe("plain-language descriptions", () => {
  it("says how often a spin turns, which way, and what its fastest point does", () => {
    const text = describeSpin({ axis: Y, pivot: { x: 0, y: 0.5, z: 0 }, speed: Math.PI / 2 }, CORNERS);
    expect(text).toMatch(/One turn every 4 s, counter-clockwise/);
    expect(text).toMatch(/→ Push/);
  });

  it("walks a swing through its cycle and names its danger and phase", () => {
    const text = describeSwing(
      { axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 1, z: -3 }, amplitude: Math.PI / 2, period: 1.2, easing: "easeInOut", pause: 0.1, phase: 0.5 },
      CORNERS,
    );
    expect(text).toMatch(/^Swings ±90°: over in 0.5 s, waits 0.1 s, back in 0.5 s, waits 0.1 s\./);
    expect(text).toMatch(/→ Ragdoll/);
    expect(text).toMatch(/Starts 0.6 s into its cycle\./);
  });

  it("says how far a slide travels", () => {
    expect(describeSlide({ offset: { x: 0, y: 3, z: 4 }, period: 4, easing: "linear" }, CORNERS)).toMatch(/^Travels 5 m: out in 2 s, back in 2 s\./);
  });
});

describe("motionPath", () => {
  it("traces the fastest corner round one full turn of a spin", () => {
    const path = motionPath({ spin: { axis: Y, pivot: { x: 0, y: 0.5, z: 0 }, speed: Math.PI } }, CORNERS, 40);
    const radius = Math.hypot(1, 3);
    for (const point of path.points) expect(Math.hypot(point.x, point.z)).toBeCloseTo(radius, 3);
    // A closed loop: it ends where it started.
    expect(path.points.at(-1)!.x).toBeCloseTo(path.points[0]!.x, 3);
    expect(path.outcomes).toHaveLength(path.points.length);
  });

  it("follows a slide out to its offset and back over its period", () => {
    const path = motionPath({ slide: { offset: { x: 5, y: 0, z: 0 }, period: 2, easing: "linear" } }, CORNERS, 20);
    const xs = path.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5, 1);
  });
});

describe("at a Segment's scale (ADR 0062)", () => {
  it("is as fast as it is big, and slides as far", () => {
    const spin = { axis: Y, pivot: { x: 0, y: 0.5, z: 0 }, speed: 2 };
    expect(topSpeedAt({ spin }, 0, CORNERS, 3)).toBeCloseTo(3 * topSpeedAt({ spin }, 0, CORNERS), 5);
    expect(describeSlide({ offset: { x: 4, y: 0, z: 0 }, period: 4, easing: "linear" }, CORNERS, 2)).toMatch(/^Travels 8 m/);
  });
});
