import { SPIN_MAX_SPEED } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  advanceGrabberLean,
  GRABBER_LEAN_CLAMP,
  GRABBER_LEAN_MAX,
  restGrabberLean,
  spinLoad,
  spinSpeedOf,
} from "./grabberLean.js";

const FRAME = 1 / 60;
/** Run the lean for `seconds` at a steady spin, and answer where it ended. */
const hold = (speed: number, seconds: number, lean = restGrabberLean()): number => {
  let angle = 0;
  for (let t = 0; t < seconds; t += FRAME) angle = advanceGrabberLean(lean, speed, FRAME);
  return angle;
};

describe("the grabber's lean (.scratch/physical-ragdoll ticket 04)", () => {
  it("stands straight while it is holding nobody", () => {
    expect(hold(0, 1)).toBe(0);
  });

  it("leans harder the faster it whirls, and never past its brace", () => {
    const slow = hold(SPIN_MAX_SPEED * 0.3, 1.5);
    const full = hold(SPIN_MAX_SPEED, 1.5);
    expect(slow).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(slow);
    expect(full).toBeLessThanOrEqual(GRABBER_LEAN_MAX + 1e-6);
  });

  /**
   * The release: the load the grabber was braced against vanishes in one
   * frame while it is still leaning into it, so it goes *past* its own lean
   * before catching itself — which is the whole reason this is a spring and
   * not an ease.
   */
  it("throws its weight past the lean when the body leaves, then rocks back upright", () => {
    const lean = restGrabberLean();
    const held = hold(SPIN_MAX_SPEED, 1.5, lean);
    let overshoot = held;
    for (let t = 0; t < 0.3; t += FRAME) overshoot = Math.max(overshoot, advanceGrabberLean(lean, 0, FRAME));
    expect(overshoot, "past the lean it was holding").toBeGreaterThan(held + 0.02);
    // …and it settles, rather than ringing forever.
    let angle = overshoot;
    for (let t = 0; t < 3; t += FRAME) angle = advanceGrabberLean(lean, 0, FRAME);
    expect(Math.abs(angle)).toBeLessThan(0.01);
  });

  it("rocks a flick barely at all next to a full Spin", () => {
    const after = (speed: number): number => {
      const lean = restGrabberLean();
      const held = hold(speed, 1.5, lean);
      let peak = held;
      for (let t = 0; t < 0.3; t += FRAME) peak = Math.max(peak, advanceGrabberLean(lean, 0, FRAME));
      return peak - held;
    };
    expect(after(SPIN_MAX_SPEED * 0.2)).toBeLessThan(after(SPIN_MAX_SPEED));
  });

  it("never leaves the clamp, however wild the spin", () => {
    const lean = restGrabberLean();
    hold(SPIN_MAX_SPEED * 6, 2, lean);
    let angle = 0;
    for (let t = 0; t < 2; t += FRAME) {
      angle = advanceGrabberLean(lean, 0, FRAME);
      expect(Math.abs(angle)).toBeLessThanOrEqual(GRABBER_LEAN_CLAMP + 1e-9);
    }
  });

  it("survives a hitched frame without blowing up", () => {
    const lean = restGrabberLean();
    hold(SPIN_MAX_SPEED, 1, lean);
    const angle = advanceGrabberLean(lean, 0, 2.5); // a 2.5-second frame
    expect(Number.isFinite(angle)).toBe(true);
    expect(Math.abs(angle)).toBeLessThanOrEqual(GRABBER_LEAN_CLAMP + 1e-9);
  });

  it("measures the load a body on the end of an arm really pulls with", () => {
    expect(spinLoad(0)).toBe(0);
    // Quadratic in the spin rate: twice round is four times the pull.
    expect(spinLoad(2 * SPIN_MAX_SPEED) / spinLoad(SPIN_MAX_SPEED)).toBeCloseTo(4, 6);
  });

  it("reads the replicated wind-up as the rate the body is really carried at", () => {
    expect(spinSpeedOf(0)).toBe(0);
    expect(spinSpeedOf(10_000)).toBeCloseTo(SPIN_MAX_SPEED, 6); // long past full wind
  });
});
