import { describe, expect, it } from "vitest";
import { STAGE_SOUND_SLOTS } from "./slots.js";
import {
  FINAL_ROUND_DELAY_MS,
  HURRY_UP_AT_MS,
  LATE_CALL_GRACE_MS,
  MatchCalls,
  type MatchFrame,
  type MatchResultsFrame,
} from "./matchCalls.js";

const frame = (over: Partial<MatchFrame> = {}): MatchFrame => ({
  phase: "LOBBY",
  serverNowMs: 0,
  countdownEndsAtMs: null,
  timeLeftMs: 60_000,
  checkpointIndex: null,
  qualified: false,
  spectating: false,
  results: null,
  ...over,
});

/** A Countdown seen from `firstSeenMs` (server clock), ending at 13 000, stepped every `stepMs`. */
const countdown = (calls: MatchCalls, firstSeenMs: number, stepMs = 16, over: Partial<MatchFrame> = {}): string[] => {
  const heard: string[] = [];
  for (let now = firstSeenMs; now < 13_300; now += stepMs) {
    const phase = now < 13_000 ? "COUNTDOWN" : "RUNNING";
    heard.push(...calls.update(frame({ phase, serverNowMs: now, countdownEndsAtMs: 13_000, ...over })));
  }
  return heard;
};

/** COUNTDOWN frames at 144 Hz from `fromMs` until `untilMs` (server clock), each carrying the end `endsAtMs`. */
const countdownFrames = (calls: MatchCalls, fromMs: number, untilMs: number, endsAtMs: number): string[] => {
  const heard: string[] = [];
  for (let now = fromMs; now < untilMs; now += 1000 / 144) {
    heard.push(...calls.update(frame({ phase: "COUNTDOWN", serverNowMs: now, countdownEndsAtMs: endsAtMs })));
  }
  return heard;
};

const RESULTS = (over: Partial<MatchResultsFrame> = {}): MatchResultsFrame => ({
  matchOver: false,
  won: false,
  soleWinner: false,
  finalRoundNext: false,
  ...over,
});

describe("MatchCalls (M14 ticket 10, ADR 0087)", () => {
  it("counts the Countdown on the server's clock, three still heard a round trip late", () => {
    const calls = new MatchCalls();
    calls.update(frame({ serverNowMs: 9_000 }));
    // The first COUNTDOWN snapshot shows up 150 ms after the Countdown began.
    expect(countdown(calls, 10_150)).toEqual(["match.count_3", "match.count_2", "match.count_1", "match.go"]);
  });

  it("gives a client that joins mid-Countdown only what is left", () => {
    expect(countdown(new MatchCalls(), 10_000 + LATE_CALL_GRACE_MS + 800)).toEqual(["match.count_2", "match.count_1", "match.go"]);
  });

  it("says only the latest call after a long frame", () => {
    const calls = new MatchCalls();
    calls.update(frame({ phase: "COUNTDOWN", serverNowMs: 10_050, countdownEndsAtMs: 13_000 }));
    expect(calls.update(frame({ phase: "COUNTDOWN", serverNowMs: 12_500, countdownEndsAtMs: 13_000 }))).toEqual(["match.count_1"]);
    expect(calls.update(frame({ phase: "RUNNING", serverNowMs: 13_010, countdownEndsAtMs: null }))).toEqual(["match.go"]);
  });

  it("says go once while the snapshots still read COUNTDOWN past its end (ADR 0109)", () => {
    // Stamped on the Tick grid, the end is the Tick RUNNING starts on, and that
    // snapshot is a one-way trip plus the Tick's own work away.
    const calls = new MatchCalls();
    calls.update(frame({ serverNowMs: 9_000 }));
    const heard: string[] = [];
    for (let now = 12_950; now < 13_060; now += 1000 / 144) {
      const phase = now < 13_000 + (3 * 1000) / 144 ? "COUNTDOWN" : "RUNNING";
      heard.push(...calls.update(frame({ phase, serverNowMs: now, countdownEndsAtMs: phase === "COUNTDOWN" ? 13_000 : null })));
    }
    expect(heard.filter((slot) => slot === "match.go")).toEqual(["match.go"]);
  });

  it("never says go twice when a stall moves the end later after it played", () => {
    const calls = new MatchCalls();
    calls.update(frame({ serverNowMs: 9_000 }));
    const heard = countdownFrames(calls, 12_950, 13_020, 13_000);
    // The server stalled over the end and rebased its clock: its next
    // COUNTDOWN snapshots carry an end 350 ms later, and RUNNING comes after.
    heard.push(...countdownFrames(calls, 13_020, 13_420, 13_350));
    heard.push(...calls.update(frame({ phase: "RUNNING", serverNowMs: 13_420 })));
    expect(heard.filter((slot) => slot === "match.go")).toEqual(["match.go"]);

    // The next Round's Countdown is entered afresh.
    calls.update(frame({ phase: "ROUND_END", serverNowMs: 20_000 }));
    expect(countdownFrames(calls, 29_950, 30_020, 30_000)).toEqual(["match.go"]);
  });

  it("stays quiet without a server clock, and while spectating", () => {
    const blind = new MatchCalls();
    for (let i = 0; i < 10; i += 1) expect(blind.update(frame({ phase: "COUNTDOWN", serverNowMs: null, countdownEndsAtMs: 13_000 }))).toEqual([]);
    expect(countdown(new MatchCalls(), 10_100, 16, { spectating: true })).toEqual([]);
  });

  it("hurries once as the clock passes its mark, never in a short Round", () => {
    const calls = new MatchCalls();
    calls.update(frame({ phase: "RUNNING", timeLeftMs: HURRY_UP_AT_MS + 100 }));
    expect(calls.update(frame({ phase: "RUNNING", timeLeftMs: HURRY_UP_AT_MS - 100 }))).toEqual(["match.hurry_up"]);
    expect(calls.update(frame({ phase: "RUNNING", timeLeftMs: HURRY_UP_AT_MS - 200 }))).toEqual([]);

    const short = new MatchCalls();
    short.update(frame({ phase: "RUNNING", timeLeftMs: HURRY_UP_AT_MS }));
    expect(short.update(frame({ phase: "RUNNING", timeLeftMs: HURRY_UP_AT_MS - 100 }))).toEqual([]);
  });

  it("chimes your own Checkpoints and Qualification once each, never a new Round's reset", () => {
    const calls = new MatchCalls();
    calls.update(frame({ phase: "RUNNING" }));
    expect(calls.update(frame({ phase: "RUNNING", checkpointIndex: 0 }))).toEqual(["match.checkpoint"]);
    expect(calls.update(frame({ phase: "RUNNING", checkpointIndex: 0 }))).toEqual([]);
    expect(calls.update(frame({ phase: "RUNNING", checkpointIndex: 1, qualified: true }))).toEqual(["match.checkpoint", "match.qualified"]);
    // A replay that briefly undoes the Qualification is still one.
    calls.update(frame({ phase: "RUNNING", checkpointIndex: 1 }));
    expect(calls.update(frame({ phase: "RUNNING", checkpointIndex: 1, qualified: true }))).toEqual([]);

    calls.update(frame({ phase: "ROUND_END", checkpointIndex: 1, qualified: true }));
    calls.update(frame({ phase: "COUNTDOWN", countdownEndsAtMs: 99_000, serverNowMs: 90_000 }));
    expect(calls.update(frame({ phase: "RUNNING", serverNowMs: 90_016 }))).toEqual([]);
    expect(calls.update(frame({ phase: "RUNNING", serverNowMs: 90_032, checkpointIndex: 0, qualified: true }))).toEqual([
      "match.checkpoint",
      "match.qualified",
    ]);
  });

  it("ends a Round on a jingle, with time over when the clock ran out", () => {
    const calls = new MatchCalls();
    calls.update(frame({ phase: "RUNNING", timeLeftMs: 5 }));
    expect(calls.update(frame({ phase: "ROUND_END", timeLeftMs: 0, spectating: true }))).toEqual(["match.time_over", "match.round_end"]);
    expect(calls.update(frame({ phase: "ROUND_END", timeLeftMs: 0 }))).toEqual([]);

    const early = new MatchCalls();
    early.update(frame({ phase: "RUNNING", timeLeftMs: 20_000 }));
    expect(early.update(frame({ phase: "ROUND_END", timeLeftMs: 20_000 }))).toEqual(["match.round_end"]);
  });

  it("plays the Results by how the Match stands, and announces the final round after", () => {
    const heard = (results: MatchResultsFrame): string[] => {
      const calls = new MatchCalls();
      calls.update(frame({ phase: "ROUND_END" }));
      return calls.update(frame({ phase: "RESULTS", results, spectating: true }));
    };
    expect(heard(RESULTS())).toEqual(["match.results"]);
    expect(heard(RESULTS({ matchOver: true }))).toEqual(["match.results"]);
    expect(heard(RESULTS({ matchOver: true, won: true, soleWinner: true }))).toEqual(["match.results_win", "match.you_win"]);
    expect(heard(RESULTS({ matchOver: true, won: true }))).toEqual(["match.results_win", "match.congratulations"]);

    const calls = new MatchCalls();
    calls.update(frame({ phase: "ROUND_END", serverNowMs: 1_000 }));
    expect(calls.update(frame({ phase: "RESULTS", serverNowMs: 1_016, results: RESULTS({ finalRoundNext: true }) }))).toEqual([
      "match.results",
    ]);
    expect(calls.update(frame({ phase: "RESULTS", serverNowMs: 1_016 + FINAL_ROUND_DELAY_MS - 1, results: RESULTS() }))).toEqual([]);
    expect(calls.update(frame({ phase: "RESULTS", serverNowMs: 1_016 + FINAL_ROUND_DELAY_MS, results: RESULTS() }))).toEqual([
      "match.final_round",
    ]);
    expect(calls.update(frame({ phase: "RESULTS", serverNowMs: 5_000, results: RESULTS() }))).toEqual([]);
  });

  it("decodes every call with the Stage", () => {
    for (const slot of ["match.count_3", "match.go", "match.hurry_up", "match.time_over", "match.final_round", "match.you_win"]) {
      expect(STAGE_SOUND_SLOTS).toContain(slot);
    }
  });

  it("says nothing for the phase a client first connects into, or through a Lobby Track reload", () => {
    expect(new MatchCalls().update(frame({ phase: "RESULTS", results: RESULTS({ matchOver: true, won: true }) }))).toEqual([]);
    expect(new MatchCalls().update(frame({ phase: "ROUND_END", timeLeftMs: 0 }))).toEqual([]);
    const calls = new MatchCalls();
    for (let i = 0; i < 20; i += 1) expect(calls.update(frame({ serverNowMs: i * 16, checkpointIndex: i % 2 === 0 ? null : 3 }))).toEqual([]);
  });
});
