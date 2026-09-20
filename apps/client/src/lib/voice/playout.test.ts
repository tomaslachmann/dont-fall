import { describe, expect, it } from "vitest";
import { VOICE_FRAME_MS, VOICE_JITTER_MAX_MS, VOICE_JITTER_TARGET_MS } from "@dont-fall/shared";
import { SpeakerPlayout } from "./playout.js";

const FRAME = VOICE_FRAME_MS / 1000;
const TARGET = VOICE_JITTER_TARGET_MS / 1000;
const MAX = VOICE_JITTER_MAX_MS / 1000;

describe("SpeakerPlayout", () => {
  it("starts a burst a jitter target ahead of now, never at now", () => {
    const playout = new SpeakerPlayout();

    const first = playout.place(10, FRAME);

    expect(first).toEqual({ startAt: 10 + TARGET, dropScheduled: false, opensBurst: true });
  });

  it("lays the rest of a burst back to back, so a sentence has no seam", () => {
    const playout = new SpeakerPlayout();
    const first = playout.place(10, FRAME);

    // The second frame arrives one frame later, as it does on the wire.
    const second = playout.place(10 + FRAME, FRAME);
    const third = playout.place(10 + 2 * FRAME, FRAME);

    expect(second.startAt).toBeCloseTo(first.startAt + FRAME, 9);
    expect(third.startAt).toBeCloseTo(first.startAt + 2 * FRAME, 9);
    expect([second.opensBurst, third.opensBurst]).toEqual([false, false]);
  });

  it("re-fills the buffer after a stall drains it, rather than playing the moment it is asked", () => {
    const playout = new SpeakerPlayout();
    playout.place(10, FRAME);

    // Nothing for a second: everything scheduled has long since played.
    const after = playout.place(11, FRAME);

    expect(after).toEqual({ startAt: 11 + TARGET, dropScheduled: false, opensBurst: true });
  });

  it("throws away a backlog past the cap and skips to the fresh frame", () => {
    const playout = new SpeakerPlayout();
    // A burst that all arrived at once — the catch-up after a network stall.
    // Nothing is dropped until the backlog is genuinely past the cap.
    const now = 10;
    let caughtUp = playout.place(now, FRAME);
    let backlogBefore = 0;
    for (let i = 0; i < 100 && !caughtUp.dropScheduled; i += 1) {
      backlogBefore = playout.scheduledSeconds(now);
      caughtUp = playout.place(now, FRAME);
      if (!caughtUp.dropScheduled) expect(backlogBefore).toBeLessThanOrEqual(MAX);
    }

    expect(caughtUp.dropScheduled).toBe(true);
    expect(backlogBefore).toBeGreaterThan(MAX);
    expect(caughtUp.opensBurst).toBe(false);
    // The fresh frame starts a target ahead of now, not behind the stale ones.
    expect(caughtUp.startAt).toBeCloseTo(now + TARGET, 9);
    // And what follows lays back to back on the new anchor, not the old one.
    expect(playout.place(now + FRAME, FRAME).startAt).toBeCloseTo(caughtUp.startAt + FRAME, 9);
  });

  it("holds a backlog that is merely buffered — a drop is the last resort, not the first", () => {
    const playout = new SpeakerPlayout();
    const now = 10;
    // Enough to sit comfortably between the target and the cap.
    const frames = Math.floor((MAX / FRAME) / 2);
    for (let i = 0; i < frames; i += 1) playout.place(now, FRAME);

    const next = playout.place(now, FRAME);

    expect(next.dropScheduled).toBe(false);
    expect(playout.scheduledSeconds(now)).toBeLessThan(MAX + FRAME);
  });

  it("reports nothing scheduled once the clock has run past the horizon", () => {
    const playout = new SpeakerPlayout();
    playout.place(10, FRAME);

    expect(playout.scheduledSeconds(10)).toBeCloseTo(TARGET + FRAME, 9);
    expect(playout.scheduledSeconds(100)).toBe(0);
  });

  it("opens a fresh burst after a reset — a speaker who left and came back is not played into the past", () => {
    const playout = new SpeakerPlayout();
    playout.place(10, FRAME);

    playout.reset();

    expect(playout.place(10, FRAME)).toEqual({ startAt: 10 + TARGET, dropScheduled: false, opensBurst: true });
  });
});
