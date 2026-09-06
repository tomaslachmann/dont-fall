import type { PingMessage, PongMessage } from "@dont-fall/shared";

/**
 * NTP-style client↔server clock sync (ADR 0019).
 *
 * The client pings with its monotonic-clock reading `T1`; the server replies
 * with `T1` echoed plus its own clock `T3`; on receipt at `T4` the client has
 * `rtt = T4 - T1` and `offset = T3 - (T1 + T4) / 2` — how far the server's
 * `performance.now()` leads the client's. Over a window of samples the estimate
 * from the *lowest-RTT* sample is the best (lowest RTT correlates with lowest
 * error — RFC 1129/1305); samples more than 1σ off the median offset are
 * discarded first. The live estimate slews toward that best value at a bounded
 * rate so a latency spike is absorbed, not shown as a jump.
 *
 * Everything is in milliseconds on a monotonic clock — never `Date.now()`.
 */

const WINDOW = 16;
/** Max correction applied per second while slewing toward a new estimate (ms/s). Derived for this game, not an NTP constant. */
const SLEW_RATE_MS_PER_S = 25;
/** Above this error the estimate snaps instead of slewing (ms). */
const SNAP_THRESHOLD_MS = 100;

interface Sample {
  rttMs: number;
  /** server `performance.now()` minus client `performance.now()` at the same instant. */
  offsetMs: number;
}

export class TimeSync {
  private readonly samples: Sample[] = [];
  private slewedOffsetMs = 0;
  private hasEstimate = false;

  /** The message to send. Call at the ping cadence (burst at join, then ~1/s). */
  ping(nowMs: number): PingMessage {
    return { type: "ping", clientTimeMs: nowMs };
  }

  /** Feed a pong reply. `nowMs` is `performance.now()` at receipt (`T4`). */
  receivePong(pong: PongMessage, nowMs: number): void {
    const rttMs = nowMs - pong.clientTimeMs;
    if (rttMs < 0 || rttMs > 5000) return; // nonsense — a suspended tab, a clock jump
    const offsetMs = pong.serverTimeMs - (pong.clientTimeMs + nowMs) / 2;
    this.samples.push({ rttMs, offsetMs });
    if (this.samples.length > WINDOW) this.samples.shift();

    const target = this.bestOffsetMs();
    if (!this.hasEstimate) {
      this.slewedOffsetMs = target;
      this.hasEstimate = true;
    }
  }

  /** Advance the slew toward the current best estimate. Call once per frame with the elapsed ms. */
  tick(elapsedMs: number): void {
    if (!this.hasEstimate) return;
    const target = this.bestOffsetMs();
    const diff = target - this.slewedOffsetMs;
    if (Math.abs(diff) > SNAP_THRESHOLD_MS) {
      this.slewedOffsetMs = target;
      return;
    }
    const maxStep = (SLEW_RATE_MS_PER_S * elapsedMs) / 1000;
    this.slewedOffsetMs += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
  }

  get ready(): boolean {
    return this.hasEstimate;
  }

  /** server `performance.now()` ≈ client `performance.now()` + this. */
  get serverClockOffsetMs(): number {
    return this.slewedOffsetMs;
  }

  /** Lowest round-trip time seen in the window (ms) — for the one-way latency term and the net-graph. */
  get rttMs(): number {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rttMs)) : 0;
  }

  private bestOffsetMs(): number {
    if (this.samples.length === 0) return this.slewedOffsetMs;
    const offsets = this.samples.map((s) => s.offsetMs).sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)]!;
    const variance =
      offsets.reduce((acc, o) => acc + (o - median) ** 2, 0) / offsets.length;
    const sd = Math.sqrt(variance);
    const kept = this.samples.filter((s) => Math.abs(s.offsetMs - median) <= sd || sd === 0);
    // Of the survivors, trust the one that made the fastest round trip.
    return kept.reduce((best, s) => (s.rttMs < best.rttMs ? s : best), kept[0]!).offsetMs;
  }
}
