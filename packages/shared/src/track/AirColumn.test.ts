import { describe, expect, it } from "vitest";
import {
  AIR_MOUTH_SHARE,
  AIR_PUFF_COUNT,
  AIR_PUFF_RISE,
  AIR_PUFF_TINT_SPREAD,
  AIR_PUFF_VARIANTS,
  AIR_SWOOSH_COUNT,
  AIR_SWOOSH_CURL,
  AIR_SWOOSH_SPEED,
  AIR_SWOOSH_TURNS,
  airColumnFrame,
  airPuffPlacement,
  airPuffSeed,
  airSwooshAlpha,
  airSwooshHead,
  airSwooshPoint,
  airSwooshSeed,
  airSwooshSpan,
  airSwooshWidth,
} from "./AirColumn.js";
import type { VolumeConfig } from "../simulation/Volume.js";

// The procedural `updraft` Module's own field: a 3×6×4 column lifting at 40.
const UPDRAFT: VolumeConfig = {
  bounds: { center: { x: 0, y: 3, z: 0 }, halfExtents: { x: 1.5, y: 3, z: 2 } },
  force: { x: 0, y: 40, z: 0 },
  maxInducedSpeed: 10,
  priority: 1,
};
const SIZE = { length: 6, halfWidth: 1.5 };

const radial = (p: { x: number; z: number }): number => Math.hypot(p.x, p.z);

describe("airColumnFrame", () => {
  it("frames an updraft as a +Y flow entering at the column's foot", () => {
    const frame = airColumnFrame(UPDRAFT)!;
    expect(frame.axis).toEqual({ x: 0, y: 1, z: 0 });
    expect(frame.entry).toEqual({ x: 0, y: 0, z: 0 });
    expect(frame.length).toBeCloseTo(6, 10);
  });

  it("spreads the air to half the narrowest cross-section", () => {
    // Cross-section 3×4: the 3-wide walls are the binding ones.
    expect(airColumnFrame(UPDRAFT)!.halfWidth).toBe(1.5);
  });

  it("follows the force, not the world's up — a sideways wind reads sideways", () => {
    const wind: VolumeConfig = {
      ...UPDRAFT,
      bounds: { center: { x: 5, y: 1, z: 0 }, halfExtents: { x: 4, y: 1, z: 2 } },
      force: { x: -20, y: 0, z: 0 },
    };
    const frame = airColumnFrame(wind)!;
    expect(frame.axis).toEqual({ x: -1, y: 0, z: 0 });
    expect(frame.entry).toEqual({ x: 9, y: 1, z: 0 });
    expect(frame.length).toBeCloseTo(8, 10);
    expect(frame.halfWidth).toBe(1);
  });

  it("draws nothing for a volume with no force — walking in does nothing, so nothing should promise flow", () => {
    expect(airColumnFrame({ ...UPDRAFT, force: { x: 0, y: 0, z: 0 } })).toBeNull();
  });
});

describe("swooshes", () => {
  const seeds = Array.from({ length: AIR_SWOOSH_COUNT }, (_, i) => airSwooshSeed(i));

  it("seeds the same swooshes every time, each inside its ranges", () => {
    expect(airSwooshSeed(3)).toEqual(airSwooshSeed(3));
    for (const seed of seeds) {
      expect(seed.radiusShare).toBeGreaterThanOrEqual(0.45);
      expect(seed.radiusShare).toBeLessThanOrEqual(1);
      expect(seed.phase).toBeGreaterThanOrEqual(0);
      expect(seed.phase).toBeLessThan(1);
    }
    // Spread around the axis, not bunched on one side.
    const quadrants = new Set(seeds.map((s) => Math.floor(((s.angle % (2 * Math.PI)) + 2 * Math.PI) / (Math.PI / 2)) % 4));
    expect(quadrants.size).toBe(4);
  });

  it("leaves the mouth at the entry and spreads out to the column's width", () => {
    const seed = { ...seeds[0]!, radiusShare: 1 };
    const entry = airSwooshPoint(0, seed, SIZE);
    expect(entry.y).toBe(0);
    expect(radial(entry)).toBeCloseTo(AIR_MOUTH_SHARE * SIZE.halfWidth, 10);
    const beforeCurl = airSwooshPoint(0.7, seed, SIZE);
    expect(radial(beforeCurl)).toBeGreaterThan(radial(entry));
    expect(radial(beforeCurl)).toBeLessThan(SIZE.halfWidth);
    expect(beforeCurl.y).toBeCloseTo(0.7 * SIZE.length, 10);
  });

  it("spirals: the angle winds by the shared turns over the column", () => {
    const seed = { ...seeds[0]!, angle: 0 };
    const at = (t: number): number => {
      const p = airSwooshPoint(t, seed, SIZE);
      return Math.atan2(p.z, p.x);
    };
    expect(at(0)).toBeCloseTo(0, 10);
    expect(at(0.25)).toBeCloseTo(AIR_SWOOSH_TURNS * Math.PI * 2 * 0.25, 10);
  });

  it("curls out at the far end — flared by the curl and drooped below a straight rise", () => {
    const seed = { ...seeds[0]!, radiusShare: 1 };
    const exit = airSwooshPoint(1, seed, SIZE);
    expect(radial(exit)).toBeCloseTo(SIZE.halfWidth + AIR_SWOOSH_CURL, 10);
    expect(exit.y).toBeCloseTo(SIZE.length - AIR_SWOOSH_CURL * 0.6, 10);
  });

  it("writes into the point it is given", () => {
    const out = { x: 9, y: 9, z: 9 };
    expect(airSwooshPoint(0.5, seeds[1]!, SIZE, out)).toBe(out);
    expect(out).toEqual(airSwooshPoint(0.5, seeds[1]!, SIZE));
  });

  it("travels along the column at its own pace and loops past the exit", () => {
    const seed = { ...seeds[0]!, phase: 0, pace: 1 };
    const span = airSwooshSpan(seed);
    expect(airSwooshHead(0, seed, SIZE)).toBe(0);
    // One second in, the head has run SPEED units: a share of the 6-long column.
    expect(airSwooshHead(1000, seed, SIZE)).toBeCloseTo(AIR_SWOOSH_SPEED / SIZE.length, 10);
    const cycleMs = (((1 + span) * SIZE.length) / AIR_SWOOSH_SPEED) * 1000;
    expect(airSwooshHead(cycleMs * 0.999, seed, SIZE)).toBeGreaterThan(1);
    expect(airSwooshHead(cycleMs * 1.001, seed, SIZE)).toBeLessThan(0.01);
  });

  it("tapers to a point at the head and to nothing at the tail", () => {
    expect(airSwooshWidth(0)).toBe(0);
    expect(airSwooshWidth(1)).toBe(0);
    expect(airSwooshWidth(0.1)).toBeGreaterThan(airSwooshWidth(0.8));
  });

  it("fades in past the entry and out before the exit, and is gone outside the column", () => {
    expect(airSwooshAlpha(-0.2)).toBe(0);
    expect(airSwooshAlpha(0)).toBe(0);
    expect(airSwooshAlpha(0.5)).toBeGreaterThan(0.5);
    expect(airSwooshAlpha(1)).toBe(0);
    expect(airSwooshAlpha(1.2)).toBe(0);
  });
});

describe("puffs", () => {
  const seeds = Array.from({ length: AIR_PUFF_COUNT }, (_, i) => airPuffSeed(i));

  it("seeds the same puffs every time, taking the shapes in turn", () => {
    expect(airPuffSeed(5)).toEqual(airPuffSeed(5));
    expect(seeds.map((s) => s.variant)).toEqual(seeds.map((_, i) => i % AIR_PUFF_VARIANTS));
    for (const seed of seeds) {
      expect(seed.tint).toBeGreaterThanOrEqual(0);
      expect(seed.tint).toBeLessThanOrEqual(AIR_PUFF_TINT_SPREAD);
    }
  });

  it("pops out of the mouth at nothing, grows, and shrinks away before it loops", () => {
    const seed = { ...seeds[0]!, phase: 0, pace: 1 };
    const cycleMs = ((SIZE.length * AIR_PUFF_RISE) / 1.6) * 1000;
    const born = airPuffPlacement(0, seed, SIZE);
    expect(born.scale).toBe(0);
    expect(born.y).toBe(0);
    expect(airPuffPlacement(cycleMs * 0.3, seed, SIZE).scale).toBeGreaterThan(0);
    expect(airPuffPlacement(cycleMs * 0.999, seed, SIZE).scale).toBeLessThan(0.001);
  });

  it("rises, slowing, no higher than its share of the column", () => {
    const seed = { ...seeds[0]!, phase: 0, pace: 1 };
    const cycleMs = ((SIZE.length * AIR_PUFF_RISE) / 1.6) * 1000;
    const heights = [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => airPuffPlacement(cycleMs * u, seed, SIZE).y);
    for (let i = 1; i < heights.length; i += 1) expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    expect(heights[1]! - heights[0]!).toBeGreaterThan(heights[4]! - heights[3]!);
    expect(Math.max(...heights)).toBeLessThanOrEqual(SIZE.length * AIR_PUFF_RISE);
  });

  it("stays inside the column's width", () => {
    for (const seed of seeds) {
      for (let ms = 0; ms < 4000; ms += 250) {
        expect(radial(airPuffPlacement(ms, seed, SIZE))).toBeLessThanOrEqual(SIZE.halfWidth);
      }
    }
  });
});
