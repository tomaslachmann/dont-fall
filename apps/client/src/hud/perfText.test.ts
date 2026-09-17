import { describe, expect, it } from "vitest";
import type { DurationSummary } from "@dont-fall/shared";
import type { PerfView, SpanSummary } from "../game/perfMonitor.js";
import { formatAudioLine, formatPerfText } from "./perfText.js";

const summary = (overrides: Partial<DurationSummary> = {}): DurationSummary => ({
  count: 120,
  meanMs: 1,
  p50Ms: 1,
  p95Ms: 1,
  p99Ms: 1,
  maxMs: 1,
  over: [],
  ...overrides,
});

const WINDOW: SpanSummary = {
  seconds: 2,
  frames: 120,
  frameMs: summary({ p50Ms: 16.7, p95Ms: 18.25, p99Ms: 25, maxMs: 40.1, over: [12, 2, 0] }),
  simMs: summary({ p95Ms: 0.6 }),
  renderCpuMs: summary({ p95Ms: 2.1 }),
  reconcileMs: summary({ p95Ms: 1.2 }),
  simStepsMax: 2,
  replayedTicks: 12,
  replayedTicksMaxPerFrame: 6,
  corrections: 4,
  correctionsPerMinute: 120,
};

const view = (window: SpanSummary | null): PerfView => ({
  window,
  render: { calls: 152, triangles: 95_210, geometries: 41, textures: 33, programs: 12 },
  run: { seconds: 312.4, frames: 18_432, over: [120, 14, 2] },
});

describe("formatPerfText (M13 ticket 01)", () => {
  it("lays out the last window, the latest render and the run", () => {
    expect(formatPerfText(view(WINDOW))).toBe(
      [
        "perf · last window",
        "frame  p50 16.7  p95 18.3  p99 25.0  max 40.1 ms · over 17/33/50: 12/2/0",
        "sim    p95 0.60 ms · steps ≤2 · replay ≤6 ticks · reconcile p95 1.20 ms · 120 corr/min",
        "render cpu p95 2.10 ms",
        "gpu    152 calls · 95.2k tris · 41 geo · 33 tex · 12 prog",
        "run    312 s · 18432 frames · over 17/33/50: 120/14/2",
      ].join("\n"),
    );
  });

  it("says it is still collecting before the first window closes", () => {
    const text = formatPerfText(view(null));
    expect(text).toContain("frame  collecting…");
    expect(text).not.toContain("sim ");
    expect(text).toContain("gpu    152 calls");
  });
});

describe("the audio line (M14 ticket 13)", () => {
  it("shows what plays, what the budget dropped this second, and the decoded size", () => {
    expect(
      formatAudioLine({ voices: 7, loopsPlaying: 3, inaudiblePerSecond: 12, overCapPerSecond: 2, decodedBytes: 3.5 * 1024 * 1024 }),
    ).toBe("audio  7 voices · 3 loops · dropped/s 12 quiet, 2 over cap · 3.5 MB decoded");
  });
});
