import { describe, expect, it } from "vitest";
import type { Vec3 } from "@dont-fall/shared";
import {
  SQUASH_COMPRESS_MS,
  SQUASH_HIGH,
  SQUASH_LOW,
  SQUASH_RELEASE_MS,
  SQUASH_TOTAL_MS,
  SpringSquashes,
  springFiredBy,
  springTriggers,
  squashScale,
  type SpringTrigger,
} from "./springSquash.js";

const SPRING: SpringTrigger = {
  trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1.1, z: 0.5 } },
  segmentIndex: 3,
};
const FAR: SpringTrigger = {
  trigger: { center: { x: 40, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1.1, z: 0.5 } },
  segmentIndex: 7,
};
const on = (spring: SpringTrigger): Vec3 => ({ ...spring.trigger.center });
const character = (position: Vec3, launchPadEpoch: number) => ({ position, launchPadEpoch });

describe("squashScale", () => {
  it("compresses, overshoots, then settles at exactly its own size", () => {
    expect(squashScale(0).y).toBe(1);
    expect(squashScale(SQUASH_COMPRESS_MS).y).toBeCloseTo(SQUASH_LOW, 6);
    expect(squashScale(SQUASH_COMPRESS_MS + SQUASH_RELEASE_MS).y).toBeCloseTo(SQUASH_HIGH, 6);
    expect(squashScale(SQUASH_TOTAL_MS).y).toBe(1);
    expect(squashScale(SQUASH_TOTAL_MS + 5000).y).toBe(1);
  });

  it("only ever shrinks during the compress and only grows during the release", () => {
    for (let ms = 1; ms < SQUASH_COMPRESS_MS; ms += 4) {
      expect(squashScale(ms).y).toBeLessThan(squashScale(ms - 1).y);
    }
    for (let ms = SQUASH_COMPRESS_MS + 1; ms < SQUASH_COMPRESS_MS + SQUASH_RELEASE_MS; ms += 4) {
      expect(squashScale(ms).y).toBeGreaterThan(squashScale(ms - 1).y);
    }
  });

  it("keeps its volume — a squash, not a piece shrinking", () => {
    for (const ms of [20, SQUASH_COMPRESS_MS, 200, 300]) {
      const { y, xz } = squashScale(ms);
      expect(xz * xz * y).toBeCloseTo(1, 6);
    }
  });
});

describe("springFiredBy", () => {
  it("picks the Spring the Character is standing in", () => {
    expect(springFiredBy(on(SPRING), [FAR, SPRING])).toBe(SPRING);
  });

  it("falls back to the nearest one when an interpolated position sits just outside", () => {
    expect(springFiredBy({ x: 0, y: 2.6, z: 0 }, [FAR, SPRING])).toBe(SPRING);
  });

  it("picks nothing when no Spring is anywhere near", () => {
    expect(springFiredBy({ x: 0, y: 200, z: 0 }, [SPRING, FAR])).toBeUndefined();
  });
});

describe("springTriggers", () => {
  it("pairs resolveTrack's two arrays, and drops a pad with no owner", () => {
    const pads = [
      { trigger: SPRING.trigger, velocity: { x: 0, y: 16, z: 0 } },
      { trigger: FAR.trigger, velocity: { x: 0, y: 16, z: 0 } },
    ];
    expect(springTriggers(pads, [3])).toEqual([{ trigger: SPRING.trigger, segmentIndex: 3 }]);
    expect(springTriggers(pads, [3, 7])).toHaveLength(2);
  });
});

describe("SpringSquashes", () => {
  it("squashes the Spring a Character just fired, and nothing else", () => {
    const squashes = new SpringSquashes();
    const springs = [SPRING, FAR];
    // First frame: whatever Epoch a Character arrives with is history.
    expect(squashes.update({ a: character(on(SPRING), 4) }, springs, 1000).size).toBe(0);

    const fired = squashes.update({ a: character(on(SPRING), 5) }, springs, 1000);
    expect([...fired.keys()]).toEqual([SPRING.segmentIndex]);
    expect(fired.get(SPRING.segmentIndex)!.y).toBe(1); // 0 ms in: about to compress
    expect(squashes.update({ a: character(on(SPRING), 5) }, springs, 1030).get(SPRING.segmentIndex)!.y).toBeLessThan(1);
  });

  it("re-firing the same Epoch value does nothing — a replayed prediction tick is not a second launch", () => {
    const squashes = new SpringSquashes();
    squashes.update({ a: character(on(SPRING), 1) }, [SPRING], 0);
    squashes.update({ a: character(on(SPRING), 2) }, [SPRING], 100);
    // Same value again, much later: no restart, so it is still winding down.
    const later = squashes.update({ a: character(on(SPRING), 2) }, [SPRING], 100 + SQUASH_TOTAL_MS - 10);
    expect(later.get(SPRING.segmentIndex)!.y).not.toBe(1);
    expect(squashes.update({ a: character(on(SPRING), 2) }, [SPRING], 100 + SQUASH_TOTAL_MS).get(SPRING.segmentIndex)!.y).toBe(1);
  });

  it("two Characters on one Spring in one frame is one squash", () => {
    const squashes = new SpringSquashes();
    squashes.update({ a: character(on(SPRING), 0), b: character(on(SPRING), 0) }, [SPRING], 0);
    const fired = squashes.update({ a: character(on(SPRING), 1), b: character(on(SPRING), 1) }, [SPRING], 500);
    expect(fired.size).toBe(1);
  });

  it("ends on exactly 1, then stops reporting — no drift after repeated fires", () => {
    const squashes = new SpringSquashes();
    squashes.update({ a: character(on(SPRING), 0) }, [SPRING], 0);
    for (const fire of [1, 2, 3]) {
      const start = fire * 10_000;
      squashes.update({ a: character(on(SPRING), fire) }, [SPRING], start);
      expect(squashes.update({ a: character(on(SPRING), fire) }, [SPRING], start + SQUASH_TOTAL_MS).get(SPRING.segmentIndex)!.y).toBe(1);
      expect(squashes.update({ a: character(on(SPRING), fire) }, [SPRING], start + SQUASH_TOTAL_MS + 16).size).toBe(0);
    }
  });

  it("reports a Spring settling once, on the frame its squash ends (M14 ticket 08)", () => {
    const squashes = new SpringSquashes();
    squashes.update({ a: character(on(SPRING), 0) }, [SPRING], 0);
    squashes.update({ a: character(on(SPRING), 1) }, [SPRING], 100);
    expect(squashes.settled()).toEqual([]);
    squashes.update({ a: character(on(SPRING), 1) }, [SPRING], 100 + SQUASH_TOTAL_MS / 2);
    expect(squashes.settled()).toEqual([]);
    squashes.update({ a: character(on(SPRING), 1) }, [SPRING], 100 + SQUASH_TOTAL_MS);
    expect(squashes.settled()).toEqual([SPRING.segmentIndex]);
    squashes.update({ a: character(on(SPRING), 1) }, [SPRING], 100 + SQUASH_TOTAL_MS + 16);
    expect(squashes.settled()).toEqual([]);
  });

  it("forgets everything on reset — Segment indices stop meaning what they meant across a Track reload", () => {
    const squashes = new SpringSquashes();
    squashes.update({ a: character(on(SPRING), 0) }, [SPRING], 0);
    squashes.update({ a: character(on(SPRING), 1) }, [SPRING], 10);
    squashes.reset();
    expect(squashes.update({ a: character(on(SPRING), 1) }, [SPRING], 20).size).toBe(0);
  });
});
