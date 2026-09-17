/**
 * A distribution of durations in milliseconds, kept as fixed-width bins (M13
 * tickets 01/02): the client's frame times and the Match server's tick times
 * both need percentiles over a whole run, and a run can be hundreds of
 * thousands of samples. Bins keep the memory fixed and `record` free of
 * allocation, at the price of percentiles resolved to one bin.
 *
 * Measurement only — nothing here is read by the simulation step.
 */
export interface DurationSummary {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** How many samples were strictly longer than each of the histogram's thresholds, in their order. */
  over: number[];
}

export interface DurationHistogramOptions {
  /** Width of one bin — the resolution of every percentile, which reads a bin's upper edge. */
  binMs: number;
  /** Durations at or past this share one overflow bin; a percentile landing there reads the true maximum. */
  rangeMs: number;
  /** Counted exactly, not from the bins — e.g. `[33, 50]` for frames over one and two display budgets. */
  thresholdsMs?: readonly number[];
}

export class DurationHistogram {
  private readonly binMs: number;
  private readonly bins: Uint32Array;
  private readonly thresholdsMs: readonly number[];
  private readonly overCounts: number[];
  private total = 0;
  private sumMs = 0;
  private longestMs = 0;

  constructor({ binMs, rangeMs, thresholdsMs = [] }: DurationHistogramOptions) {
    if (!(binMs > 0) || !(rangeMs > binMs)) throw new Error("DurationHistogram: needs 0 < binMs < rangeMs");
    this.binMs = binMs;
    // The last slot is the overflow bin.
    this.bins = new Uint32Array(Math.ceil(rangeMs / binMs) + 1);
    this.thresholdsMs = thresholdsMs;
    this.overCounts = thresholdsMs.map(() => 0);
  }

  get count(): number {
    return this.total;
  }

  /** Adds one duration. A negative one counts as zero; a non-finite one is dropped. */
  record(durationMs: number): void {
    if (!Number.isFinite(durationMs)) return;
    const ms = Math.max(durationMs, 0);
    const overflow = this.bins.length - 1;
    this.bins[Math.min(Math.floor(ms / this.binMs), overflow)]! += 1;
    this.total += 1;
    this.sumMs += ms;
    if (ms > this.longestMs) this.longestMs = ms;
    for (let i = 0; i < this.thresholdsMs.length; i += 1) {
      if (ms > this.thresholdsMs[i]!) this.overCounts[i]! += 1;
    }
  }

  /**
   * The duration `fraction` (0–1) of samples were at or under, read at the
   * upper edge of the bin it falls in, never above the longest sample.
   * Zero with no samples.
   */
  percentile(fraction: number): number {
    if (this.total === 0) return 0;
    const rank = Math.max(1, Math.ceil(fraction * this.total));
    const overflow = this.bins.length - 1;
    let seen = 0;
    for (let i = 0; i < this.bins.length; i += 1) {
      seen += this.bins[i]!;
      if (seen >= rank) return i === overflow ? this.longestMs : Math.min((i + 1) * this.binMs, this.longestMs);
    }
    return this.longestMs;
  }

  summary(): DurationSummary {
    return {
      count: this.total,
      meanMs: this.total === 0 ? 0 : this.sumMs / this.total,
      p50Ms: this.percentile(0.5),
      p95Ms: this.percentile(0.95),
      p99Ms: this.percentile(0.99),
      maxMs: this.longestMs,
      over: [...this.overCounts],
    };
  }

  reset(): void {
    this.bins.fill(0);
    this.overCounts.fill(0);
    this.total = 0;
    this.sumMs = 0;
    this.longestMs = 0;
  }
}
