import { INTERP_RATIO, interpolateState, SNAPSHOT_HZ, TICK_MS, type RenderState, type SimState } from "@dont-fall/shared";

/**
 * How far behind "now" (in server time) the client renders everything it does
 * not predict — Props, other players, this player's own ragdoll. A function of
 * the *snapshot* rate, not the tick rate (ADR 0020, Valve's
 * `max(cl_interp, cl_interp_ratio / cl_updaterate)` capped at 0.25 s): enough
 * playout room that the two snapshots bracketing the render moment have
 * essentially always arrived. At 30 Hz snapshots, ratio 2 → 66.7 ms.
 */
export const interpDelayMs = (snapshotHz: number): number =>
  Math.min(250, Math.max(TICK_MS, (INTERP_RATIO / snapshotHz) * 1000));

/** How quickly the local↔server clock offset eases toward each fresh observation, before ping/pong is ready. */
const OFFSET_EASE = 0.02;
/** Keep the buffer bounded on a long session. */
const MAX_BUFFERED = 64;

interface Buffered {
  /** Server *tick* time this snapshot represents — `tick * TICK_MS`, perfectly spaced regardless of when it landed. */
  tickMs: number;
  state: SimState;
}

/**
 * Turns a jittery stream of server snapshots into a smooth render state
 * (ADR 0017, refined by ADR 0019/0020).
 *
 * Snapshots are buffered keyed by their *server tick* time. Each frame the
 * client renders the world where it was {@link interpDelayMs} of server time
 * ago, lerping between the two buffered snapshots that bracket that moment. The
 * render target advances by real elapsed wall-clock, so the output speed is
 * constant no matter how unevenly snapshots land (the classic
 * snapshot-interpolation buffer — Fiedler, Valve `cl_interp`).
 *
 * The clock reference is the NTP-style ping/pong offset ({@link setServerClockOffsetMs},
 * ADR 0019) plus each snapshot's own `serverTimeMs` — which handles a poisoned
 * first anchor and a mid-match latency step that the old "anchor once + slow
 * ease" could not. Until a ping estimate is available it falls back to that ease.
 */
export class SnapshotInterpolator {
  private readonly buffer: Buffered[] = [];
  private delayMs: number;

  // Fallback clock: `localNow - latestTickMs`, anchored on the first snapshot and eased.
  private anchorOffsetMs: number | null = null;
  // Preferred clock: from ping/pong + the snapshot's own server timestamp.
  private pingOffsetMs: number | null = null;
  private latestTickMs: number | null = null;
  private latestServerTimeMs: number | null = null;

  constructor(snapshotHz: number = SNAPSHOT_HZ) {
    this.delayMs = interpDelayMs(snapshotHz);
  }

  /** Adopt the server's advertised snapshot rate (from `WelcomeMessage.config`, ADR 0020). */
  setSnapshotHz(snapshotHz: number): void {
    this.delayMs = interpDelayMs(snapshotHz);
  }

  /**
   * Feed a freshly received snapshot. `nowMs` is `performance.now()` at receipt;
   * `serverTimeMs` is `SnapshotMessage.serverTimeMs` (defaults to the tick time
   * for tests / a server that doesn't send it).
   */
  receive(state: SimState, nowMs: number, serverTimeMs: number = state.tick * TICK_MS): void {
    const tickMs = state.tick * TICK_MS;
    const last = this.buffer.at(-1);
    if (last && tickMs <= last.tickMs) return; // out of order or duplicate — ignore

    const observedAnchor = nowMs - tickMs;
    this.anchorOffsetMs =
      this.anchorOffsetMs === null ? observedAnchor : this.anchorOffsetMs + (observedAnchor - this.anchorOffsetMs) * OFFSET_EASE;
    this.latestTickMs = tickMs;
    this.latestServerTimeMs = serverTimeMs;

    this.buffer.push({ tickMs, state });
    while (this.buffer.length > MAX_BUFFERED) this.buffer.shift();
  }

  /** Feed the current NTP-style estimate of `serverPerformanceNow - clientPerformanceNow` (ADR 0019). */
  setServerClockOffsetMs(offsetMs: number): void {
    this.pingOffsetMs = offsetMs;
  }

  get ready(): boolean {
    return this.buffer.length > 0 && this.anchorOffsetMs !== null;
  }

  /** Buffered snapshots waiting to be played out — for the net-graph. */
  get bufferDepth(): number {
    return this.buffer.length;
  }

  /** True when the last {@link sample} had to hold the latest pose (buffer underrun). */
  holdingLatest = false;

  /** The fractional server tick currently being rendered — for tick-driven visuals (Spinner phase). */
  renderTick(nowMs: number): number {
    return this.targetTickMs(nowMs) / TICK_MS;
  }

  /** The interpolated render state for wall-clock `nowMs`. Call {@link ready} first. */
  sample(nowMs: number): RenderState {
    const target = this.targetTickMs(nowMs);
    const buf = this.buffer;

    this.holdingLatest = false;
    if (target <= buf[0]!.tickMs) return interpolateState(buf[0]!.state, buf[0]!.state, 0);
    const last = buf.at(-1)!;
    if (target >= last.tickMs) {
      this.holdingLatest = true;
      return interpolateState(last.state, last.state, 1); // buffer underrun — hold the latest
    }

    for (let i = 1; i < buf.length; i += 1) {
      const hi = buf[i]!;
      if (hi.tickMs >= target) {
        const lo = buf[i - 1]!;
        const frac = (target - lo.tickMs) / (hi.tickMs - lo.tickMs);
        if (i > 2) this.buffer.splice(0, i - 2); // prune what's safely behind the render target
        return interpolateState(lo.state, hi.state, frac);
      }
    }
    return interpolateState(last.state, last.state, 1);
  }

  /** Current server-tick time to render at, in ms (already `interpDelayMs` in the past). */
  private targetTickMs(nowMs: number): number {
    let estServerTickMs: number;
    if (this.pingOffsetMs !== null && this.latestServerTimeMs !== null && this.latestTickMs !== null) {
      // server-now (in its own perf clock) minus when it built the latest
      // snapshot = real server time elapsed since, transit latency included.
      const elapsedSinceLatest = nowMs + this.pingOffsetMs - this.latestServerTimeMs;
      estServerTickMs = this.latestTickMs + elapsedSinceLatest;
    } else {
      estServerTickMs = nowMs - (this.anchorOffsetMs ?? 0);
    }
    return estServerTickMs - this.delayMs;
  }
}
