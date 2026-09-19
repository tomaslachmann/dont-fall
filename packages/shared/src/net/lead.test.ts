import { describe, expect, it } from "vitest";
import { TICK_MS } from "../tuning/clock.js";
import {
  LEAD_DRAIN_SATURATED_FRACTION,
  LEAD_DRAIN_TIME_FRACTION,
  LEAD_FEEDBACK_FRESH_MS,
  LEAD_INJECT_COOLDOWN_MS,
  MAX_QUEUED_INPUTS,
} from "../tuning/netcode.js";
import { initialLeadState, leadAdjustMs, leadReceiveQueueDepth, type LeadState } from "./lead.js";

const RATES_HZ = [30, 60, 144, 240];
/** Well over the band, so the controller drains every frame — but under the server's cap. */
const FAT = 4;
/** At the server's cap: the queue sheds the input it was about to run. */
const SATURATED = MAX_QUEUED_INPUTS;
/** Under the band, so the controller injects whenever its cooldown allows. */
const STARVING = 0;

/** One second of frames at `hz`, each 1000/hz ms, as the frame loop hands them in. */
const secondOfFrames = (hz: number): number[] => Array.from({ length: hz }, () => 1000 / hz);

/** A controller whose average already sits at `depth`. */
const averagedAt = (depth: number): LeadState => ({ ...initialLeadState(), smoothedQueueDepth: depth });

/** One frame with a fresh report of the depth the average already holds, so it stays put. */
const reportedFrame = (state: LeadState, elapsedMs: number): number => {
  leadReceiveQueueDepth(state, state.smoothedQueueDepth);
  return leadAdjustMs(state, elapsedMs, true);
};

describe("leadAdjustMs (ADR 0109)", () => {
  it("drains the same time per second at every frame rate", () => {
    for (const hz of RATES_HZ) {
      const state = averagedAt(FAT);
      const drainedMs = -secondOfFrames(hz).reduce((sum, elapsedMs) => sum + reportedFrame(state, elapsedMs), 0);
      expect(drainedMs).toBeCloseTo(1000 * LEAD_DRAIN_TIME_FRACTION, 6);
    }
  });

  it("never stops the prediction clock while it drains, however short the frame", () => {
    for (const hz of [...RATES_HZ, 1000]) {
      const state = averagedAt(FAT);
      for (const elapsedMs of secondOfFrames(hz)) {
        const advanceMs = elapsedMs + reportedFrame(state, elapsedMs);
        expect(advanceMs).toBeCloseTo(elapsedMs * (1 - LEAD_DRAIN_TIME_FRACTION), 9);
        expect(advanceMs).toBeGreaterThan(0);
      }
    }
  });

  it("injects at most one tick per cooldown at every frame rate", () => {
    for (const hz of RATES_HZ) {
      const state = averagedAt(STARVING);
      const injectsAtMs: number[] = [];
      let nowMs = 0;
      for (let second = 0; second < 3; second += 1) {
        for (const elapsedMs of secondOfFrames(hz)) {
          nowMs += elapsedMs;
          const leadMs = reportedFrame(state, elapsedMs);
          if (leadMs > 0) {
            expect(leadMs).toBe(TICK_MS);
            injectsAtMs.push(nowMs);
          }
        }
      }
      expect(injectsAtMs.length).toBeGreaterThan(0);
      expect(injectsAtMs.length).toBeLessThanOrEqual(Math.floor(3000 / LEAD_INJECT_COOLDOWN_MS) + 1);
      for (let i = 1; i < injectsAtMs.length; i += 1) {
        expect(injectsAtMs[i]! - injectsAtMs[i - 1]!).toBeGreaterThanOrEqual(LEAD_INJECT_COOLDOWN_MS - 1e-6);
      }
    }
  });

  it("drains harder once the server's queue is at its cap, still never stopping the clock", () => {
    for (const depth of [MAX_QUEUED_INPUTS - 1, SATURATED]) {
      for (const hz of RATES_HZ) {
        const state = averagedAt(depth);
        let drainedMs = 0;
        for (const elapsedMs of secondOfFrames(hz)) {
          const leadMs = reportedFrame(state, elapsedMs);
          expect(elapsedMs + leadMs).toBeGreaterThan(0);
          drainedMs -= leadMs;
        }
        expect(drainedMs).toBeCloseTo(1000 * LEAD_DRAIN_SATURATED_FRACTION, 6);
      }
    }
    // Just under the cap is the ordinary drain.
    const state = averagedAt(MAX_QUEUED_INPUTS - 1.01);
    expect(reportedFrame(state, 10)).toBeCloseTo(-10 * LEAD_DRAIN_TIME_FRACTION, 9);
  });

  it("leaves the saturated drain on the newest report, while the average still sits at the cap", () => {
    const state = averagedAt(SATURATED);
    leadReceiveQueueDepth(state, SATURATED);
    expect(leadAdjustMs(state, 10, true)).toBeCloseTo(-10 * LEAD_DRAIN_SATURATED_FRACTION, 9);
    // The queue is back under the cap; the average, some five reports behind it, is not.
    leadReceiveQueueDepth(state, 2);
    expect(state.smoothedQueueDepth).toBeGreaterThanOrEqual(MAX_QUEUED_INPUTS - 1);
    expect(leadAdjustMs(state, 10, true)).toBeCloseTo(-10 * LEAD_DRAIN_TIME_FRACTION, 9);
    // A report back at the cap resumes it.
    leadReceiveQueueDepth(state, SATURATED);
    expect(leadAdjustMs(state, 10, true)).toBeCloseTo(-10 * LEAD_DRAIN_SATURATED_FRACTION, 9);
  });

  it("adjusts nothing on a stale report, or before the first, whatever the depth", () => {
    for (const depth of [STARVING, 2, FAT, SATURATED]) {
      // Never reported: the starting average is a guess, not feedback.
      const unheard = averagedAt(depth);
      for (const elapsedMs of secondOfFrames(60)) expect(leadAdjustMs(unheard, elapsedMs, true)).toBe(0);

      // Reported once, then silent — an idle phase's change-only Snapshots, or a stalled link.
      const silent = averagedAt(depth);
      leadReceiveQueueDepth(silent, depth);
      let ageMs = 0;
      for (const elapsedMs of Array.from({ length: 180 }, () => 1000 / 60)) {
        const leadMs = leadAdjustMs(silent, elapsedMs, true);
        if (ageMs >= LEAD_FEEDBACK_FRESH_MS) expect(leadMs).toBe(0);
        ageMs += elapsedMs;
      }
    }
  });

  it("keeps the cooldown running while gated, so the first fresh starving report injects at once", () => {
    const state = averagedAt(STARVING);
    leadReceiveQueueDepth(state, STARVING);
    expect(leadAdjustMs(state, 1000 / 60, true)).toBe(TICK_MS);
    // A second of silence: nothing injected (the report goes stale before the
    // cooldown ends), but the cooldown is long over by the end of it.
    for (const elapsedMs of secondOfFrames(60)) expect(leadAdjustMs(state, elapsedMs, true)).toBe(0);
    expect(reportedFrame(state, 1000 / 60)).toBe(TICK_MS);
  });

  it("drains only the part of a long frame the last report covers", () => {
    // The frame after a two-second hitch, with a report that queued up behind it.
    const fat = averagedAt(FAT);
    expect(reportedFrame(fat, 2000)).toBeCloseTo(-LEAD_FEEDBACK_FRESH_MS * LEAD_DRAIN_TIME_FRACTION, 9);
    const saturated = averagedAt(SATURATED);
    expect(reportedFrame(saturated, 2000)).toBeCloseTo(-LEAD_FEEDBACK_FRESH_MS * LEAD_DRAIN_SATURATED_FRACTION, 9);
    // A report 100 ms old covers only the frame's first 150 ms.
    const aged = averagedAt(FAT);
    leadReceiveQueueDepth(aged, FAT);
    aged.msSinceReport = 100;
    expect(leadAdjustMs(aged, 1000, true)).toBeCloseTo(-(LEAD_FEEDBACK_FRESH_MS - 100) * LEAD_DRAIN_TIME_FRACTION, 9);
  });
});
