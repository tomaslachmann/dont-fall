import { describe, expect, it } from "vitest";
import { DurationHistogram } from "./durationHistogram.js";

describe("DurationHistogram", () => {
  it("summarises nothing as zeros", () => {
    const histogram = new DurationHistogram({ binMs: 1, rangeMs: 100, thresholdsMs: [33] });
    expect(histogram.summary()).toEqual({ count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, over: [0] });
  });

  it("reads percentiles at the upper edge of their bin", () => {
    const histogram = new DurationHistogram({ binMs: 1, rangeMs: 100 });
    // 1..100 ms, one sample in each 1 ms bin: [0.5, 1.5, …, 99.5]
    for (let i = 0; i < 100; i += 1) histogram.record(i + 0.5);
    expect(histogram.percentile(0.5)).toBe(50);
    expect(histogram.percentile(0.95)).toBe(95);
    expect(histogram.percentile(0.99)).toBe(99);
    // The top bin's edge would be 100; the longest sample is 99.5.
    expect(histogram.percentile(1)).toBe(99.5);
  });

  it("keeps the mean and the maximum exact", () => {
    const histogram = new DurationHistogram({ binMs: 5, rangeMs: 100 });
    histogram.record(2);
    histogram.record(4);
    histogram.record(12);
    const summary = histogram.summary();
    expect(summary.meanMs).toBe(6);
    expect(summary.maxMs).toBe(12);
    expect(summary.p50Ms).toBe(5);
  });

  it("reports the true maximum for a percentile in the overflow bin", () => {
    const histogram = new DurationHistogram({ binMs: 1, rangeMs: 50 });
    histogram.record(10);
    histogram.record(400);
    expect(histogram.percentile(0.99)).toBe(400);
    expect(histogram.percentile(0.5)).toBe(11);
  });

  it("counts samples strictly over each threshold exactly", () => {
    const histogram = new DurationHistogram({ binMs: 10, rangeMs: 200, thresholdsMs: [33, 50] });
    for (const ms of [16, 33, 33.1, 49, 50, 50.01, 120]) histogram.record(ms);
    expect(histogram.summary().over).toEqual([5, 2]);
  });

  it("drops non-finite samples and floors negative ones at zero", () => {
    const histogram = new DurationHistogram({ binMs: 1, rangeMs: 10 });
    histogram.record(Number.NaN);
    histogram.record(Number.POSITIVE_INFINITY);
    histogram.record(-3);
    expect(histogram.count).toBe(1);
    expect(histogram.summary().maxMs).toBe(0);
  });

  it("resets to empty", () => {
    const histogram = new DurationHistogram({ binMs: 1, rangeMs: 10, thresholdsMs: [2] });
    histogram.record(5);
    histogram.reset();
    expect(histogram.summary()).toEqual({ count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, over: [0] });
    histogram.record(1);
    expect(histogram.percentile(1)).toBe(1);
  });

  it("refuses a range no wider than one bin", () => {
    expect(() => new DurationHistogram({ binMs: 1, rangeMs: 1 })).toThrow();
    expect(() => new DurationHistogram({ binMs: 0, rangeMs: 10 })).toThrow();
  });
});
