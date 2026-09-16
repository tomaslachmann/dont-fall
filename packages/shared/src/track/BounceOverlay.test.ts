import { describe, expect, it } from "vitest";
import {
  BOUNCE_DOME_RISE,
  BOUNCE_PRESS_DEPTH,
  BOUNCE_PRESS_HEIGHT,
  BOUNCE_IMPACT_MAX,
  BOUNCE_PRESS_RADIUS,
  BOUNCE_WOBBLE_MS,
  bounceDomeLift,
  bounceEdgeMask,
  bounceProfile,
  bouncePressFalloff,
  bounceWobble,
  invalidBounceReason,
  isSegmentBounce,
} from "./BounceOverlay.js";

describe("the sheet's rest shape", () => {
  it("stands proudest in the middle and lies flush at the rim — stitched to its own frame", () => {
    expect(bounceDomeLift(0, 0)).toBeCloseTo(BOUNCE_DOME_RISE, 10);
    for (const [u, v] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1]]) {
      expect(bounceDomeLift(u!, v!), `${u},${v}`).toBeCloseTo(0, 10);
    }
  });

  it("falls away monotonically from the middle to the rim — convex, no ripples in the rest pose", () => {
    let previous = bounceDomeLift(0, 0);
    for (let u = 0.05; u <= 1; u += 0.05) {
      const lift = bounceDomeLift(u, 0);
      expect(lift).toBeLessThan(previous);
      previous = lift;
    }
  });

  it("never lifts outside its own deck", () => {
    expect(bounceEdgeMask(1.4, 0)).toBe(0);
    expect(bounceEdgeMask(0, -2)).toBe(0);
  });

  it("is fat across the top and does its bending near the rim — inflated, not a tent", () => {
    // Halfway out, a pointed (mask-shaped) dome would have given up a quarter
    // of its height; a pumped one is still standing at three quarters.
    const halfway = bounceProfile(0.5, 0);
    expect(halfway).toBeGreaterThan(0.9);
    // The middle is nearly flat: a big step across the top barely changes height.
    expect(bounceProfile(0.2, 0) / bounceProfile(0, 0)).toBeGreaterThan(0.99);
    // …and the last stretch to the rim is where the drop happens.
    expect(bounceProfile(0.95, 0)).toBeLessThan(0.25);
  });

  it("presses at least as deep as it stands, so feet land on the deck and not inside the dome", () => {
    expect(BOUNCE_PRESS_DEPTH).toBeGreaterThanOrEqual(BOUNCE_DOME_RISE);
  });

  it("starts giving way before the feet reach the top of the dome", () => {
    // Otherwise a Character visibly falls through the skin's highest point
    // before the sheet answers at all — the artefact that appeared the first
    // time the dome was pumped up.
    expect(BOUNCE_PRESS_HEIGHT).toBeGreaterThan(BOUNCE_DOME_RISE);
  });
});

describe("a press", () => {
  it("is strongest underfoot and exactly nothing past its radius — a dent with an edge, not a tail", () => {
    expect(bouncePressFalloff(0)).toBeCloseTo(1, 10);
    expect(bouncePressFalloff(BOUNCE_PRESS_RADIUS / 2)).toBeCloseTo(0.5, 6);
    expect(bouncePressFalloff(BOUNCE_PRESS_RADIUS)).toBe(0);
    expect(bouncePressFalloff(BOUNCE_PRESS_RADIUS + 3)).toBe(0);
  });

  it("weakens smoothly with distance", () => {
    let previous = bouncePressFalloff(0);
    for (let d = 0.05; d < BOUNCE_PRESS_RADIUS; d += 0.05) {
      const reach = bouncePressFalloff(d);
      expect(reach).toBeLessThanOrEqual(previous);
      previous = reach;
    }
  });
});

describe("the ring a landing leaves", () => {
  it("dips first, then throws back past the rest shape", () => {
    const speed = 12;
    expect(bounceWobble(0, speed)).toBeGreaterThan(0); // down
    // Half a cycle in (~111 ms at 4.5 Hz) the sheet is standing prouder than
    // its own dome — that lobe is the throw-off read.
    expect(bounceWobble(1000 / (2 * 4.5), speed)).toBeLessThan(0);
  });

  it("rings harder for a harder landing, and caps", () => {
    expect(bounceWobble(0, 12)).toBeGreaterThan(bounceWobble(0, 5));
    expect(bounceWobble(0, 500)).toBeCloseTo(BOUNCE_IMPACT_MAX, 6);
  });

  it("is over — exactly zero — once its window closes, and dies down on the way", () => {
    expect(bounceWobble(BOUNCE_WOBBLE_MS, 20)).toBe(0);
    expect(bounceWobble(BOUNCE_WOBBLE_MS + 5000, 20)).toBe(0);
    expect(bounceWobble(-1, 20)).toBe(0);
    // Whatever is left at the cut is small enough that cutting it shows as nothing.
    const atCut = Math.abs(bounceWobble(BOUNCE_WOBBLE_MS - 1, 20));
    expect(atCut).toBeLessThan(0.01);
  });
});

describe("invalidBounceReason", () => {
  it("takes exactly true, like ice and mud", () => {
    expect(invalidBounceReason(true)).toBeUndefined();
    expect(isSegmentBounce(true)).toBe(true);
    expect(invalidBounceReason(false)).toMatch(/must be true/);
    expect(invalidBounceReason("yes")).toMatch(/must be true/);
    expect(isSegmentBounce(1)).toBe(false);
  });
});
