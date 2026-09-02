/**
 * Net-graph metrics (model doc §8). A single mutable struct the net/prediction
 * code updates in place; the HUD reads it each frame (pull model — the render
 * loop already runs on a frame ticker, so a skipped HUD frame just reads the
 * latest value, losing no event). Plain text, drawn into the existing DOM HUD.
 */

const RECENT = 90; // ~3 s of ticks — the window for the correction-distance percentiles

export class NetMetrics {
  rttMs = 0;
  clockOffsetMs = 0;
  /** ms since the last snapshot arrived. */
  snapshotAgeMs = 0;
  /** predicted tick − last acknowledged input tick. */
  ackAgeTicks = 0;
  predictedTick = 0;
  estServerTick = 0;
  lead = 0;
  inputBufferDepth = 0;
  commandQueueDepth = 0;
  interpBufferDepth = 0;
  extrapolating = false;
  predictedPropCount = 0;
  /** `‖capsuleErrorOffset‖` (ADR 0026) — how far the drawn mesh currently sits from the raw sim pose. */
  capsuleOffsetM = 0;

  private readonly corrections: number[] = [];
  private reconcileTimes: number[] = [];

  /** Call from `reconcile` when a position correction is applied. */
  recordCorrection(distance: number): void {
    this.corrections.push(distance);
    if (this.corrections.length > RECENT) this.corrections.shift();
    this.reconcileTimes.push(performance.now());
  }

  /** Reconciliations in the last second. */
  get reconcilesPerSec(): number {
    const cutoff = performance.now() - 1000;
    this.reconcileTimes = this.reconcileTimes.filter((t) => t >= cutoff);
    return this.reconcileTimes.length;
  }

  private percentile(p: number): number {
    if (this.corrections.length === 0) return 0;
    const sorted = [...this.corrections].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  }

  /** A compact multi-line block for the HUD. */
  format(): string {
    const c = (n: number) => n.toFixed(2);
    return (
      `net  rtt ${this.rttMs.toFixed(0)}ms · offset ${this.clockOffsetMs.toFixed(0)}ms · snap ${this.snapshotAgeMs.toFixed(0)}ms · ackAge ${this.ackAgeTicks}t\n` +
      `pred ${this.predictedTick} · server~${this.estServerTick.toFixed(0)} · lead ${this.lead.toFixed(1)} · inBuf ${this.inputBufferDepth} · srvQ ${this.commandQueueDepth} · interpBuf ${this.interpBufferDepth}${this.extrapolating ? " · EXTRAP" : ""}\n` +
      `recon ${this.reconcilesPerSec}/s · corr p50 ${c(this.percentile(0.5))} p95 ${c(this.percentile(0.95))} max ${c(this.percentile(1))} · predProps ${this.predictedPropCount} · capOff ${c(this.capsuleOffsetM)}`
    );
  }
}
