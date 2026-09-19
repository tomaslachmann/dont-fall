import {
  INTERP_RATIO,
  PLAYOUT_FLOOR_RISE_RATE,
  PLAYOUT_FLOOR_WINDOW_MAX_GAP_MS,
  PLAYOUT_FLOOR_WINDOW_MS,
  PLAYOUT_SLEW_MAX_RATE,
  PLAYOUT_SLEW_TIME_MS,
  PLAYOUT_SNAP_MS,
  interpolateState,
  SNAPSHOT_HZ,
  TICK_MS,
  type RenderState,
  type SimState,
} from "@dont-fall/shared";

/**
 * How far behind the least-delayed Snapshot arrival the client renders
 * everything it does not predict — Props, other players, this player's own
 * ragdoll (ADR 0109: counted from the arrival, not from the server's "now"). A
 * function of the *snapshot* rate, not the tick rate (ADR 0020, Valve's
 * `max(cl_interp, cl_interp_ratio / cl_updaterate)` capped at 0.25 s): one
 * snapshot interval to bracket the render moment, and one more of arrival
 * jitter before the buffer runs dry. At 30 Hz snapshots, ratio 2 → 66.7 ms.
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
 * (ADR 0017, refined by ADR 0019/0020/0109).
 *
 * Snapshots are buffered keyed by their *server tick* time. Each frame the
 * client renders the world at a point in tick time and lerps between the two
 * buffered snapshots that bracket it. That point advances by real elapsed
 * wall-clock, so the output speed is constant no matter how unevenly
 * snapshots land (the classic snapshot-interpolation buffer — Fiedler, Valve
 * `cl_interp`). Past the newest snapshot it holds the latest pose, never
 * extrapolating (ADR 0017).
 *
 * Two clocks, for two questions (ADR 0109):
 *
 * - **What to draw** — the playout clock. A snapshot's lag, `arrival −
 *   tickMs`, is clock offset + send time + one-way latency + jitter in one
 *   number, and the world is drawn {@link interpDelayMs} behind the floor of
 *   those lags, so the whole delay is jitter room and transit latency is never
 *   counted against it. (It used to be drawn behind the server's own "now",
 *   and a one-way latency over ~33 ms emptied the buffer every snapshot.) The
 *   floor drops at once to a less-delayed arrival and otherwise rises at
 *   {@link PLAYOUT_FLOOR_RISE_RATE}, rather than simply being the minimum of
 *   a fixed window: measured at RTT 40–120 ms it underran less (the few ms it
 *   rides above the true minimum are a margin that grows with jitter), and it
 *   keeps up with a server ticking a little slow, which a one-second window
 *   left ~20 ms stale. Every arrival counts, so the sparse snapshots of an
 *   idle phase (ADR 0057) still move it.
 *
 *   The rise alone follows a step *up* in lag only at that rate, though — a
 *   Wi-Fi roam, a route change, a server stall its scheduler forgave (which
 *   shifts every later Snapshot) — and until it has, the drawn tick sits past
 *   the newest snapshot and the world steps at the snapshot rate: +100 ms held
 *   for 3 s, +300 ms for ~10 s. So the floor is also bounded from below by the
 *   least lag of the last {@link PLAYOUT_FLOOR_WINDOW_MS} of arrivals. The
 *   bound is asked only of a window the arrivals cover end to end, with no gap
 *   over {@link PLAYOUT_FLOOR_WINDOW_MAX_GAP_MS}: the burst that lands when a
 *   transport stall clears lags by up to the stall, and a window of little
 *   else would pull the floor up and the drawn world back; and an idle phase's
 *   sparse snapshots keep to the rise. In steady play the rise already sits
 *   above that least lag, so the bound changes nothing there.
 *
 *   The offset between local time and the drawn tick time runs with the wall
 *   clock and is slewed toward `floor + delay` ({@link PLAYOUT_SLEW_TIME_MS},
 *   at most {@link PLAYOUT_SLEW_MAX_RATE} of elapsed time), so the drawn world
 *   never runs backward — except past {@link PLAYOUT_SNAP_MS}, where it jumps:
 *   forward when a first snapshot landed late, back when the lag steps up by
 *   more than that. That keeps ADR 0019's two fixes: a poisoned first snapshot
 *   is dropped as soon as a better one lands, and a mid-match latency step is
 *   absorbed as a change of speed rather than a long freeze — a step down at
 *   once, a step up after the window and the slew (holding 1.4 s after +100
 *   ms, 2.5 s after +200 ms), and one over ~280 ms as a single backward jump.
 * - **What the server is simulating now** — {@link estimatedServerTick}, the
 *   NTP-style ping/pong offset ({@link setServerClockOffsetMs}, ADR 0019) plus
 *   each snapshot's own `serverTimeMs`, which ADR 0027 seeds the prediction
 *   tick from. Until a ping estimate is available it falls back to an eased
 *   first-snapshot anchor.
 */
export class SnapshotInterpolator {
  private readonly buffer: Buffered[] = [];
  private delayMs: number;

  /**
   * The playout floor: the least snapshot lag seen, risen since at
   * {@link PLAYOUT_FLOOR_RISE_RATE} — and never below the least of the last
   * {@link PLAYOUT_FLOOR_WINDOW_MS} of arrivals, once they cover it.
   */
  private floorLagMs: number | null = null;
  /** When {@link floorLagMs} was last updated (local time of that arrival). */
  private floorAtMs = 0;
  /**
   * Recent arrivals, oldest first: every one inside {@link PLAYOUT_FLOOR_WINDOW_MS},
   * and the newest one at or before its start — the one that shows the window
   * was covered from its first millisecond.
   */
  private readonly arrivals: { atMs: number; lagMs: number }[] = [];
  /** Local time minus the tick time being drawn — slewed toward `floor + delayMs`. */
  private playoutOffsetMs: number | null = null;
  /** When {@link playoutOffsetMs} was last slewed. */
  private playoutAtMs = 0;

  // Fallback server clock: `localNow - latestTickMs`, anchored on the first snapshot and eased.
  private anchorOffsetMs: number | null = null;
  // Preferred server clock: from ping/pong + the snapshot's own server timestamp.
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

    // One observation, two readers: the fallback server clock eases toward
    // it, the playout floor keeps the least of it.
    const lagMs = nowMs - tickMs;
    this.anchorOffsetMs =
      this.anchorOffsetMs === null ? lagMs : this.anchorOffsetMs + (lagMs - this.anchorOffsetMs) * OFFSET_EASE;
    this.latestTickMs = tickMs;
    this.latestServerTimeMs = serverTimeMs;
    const risenLagMs =
      this.floorLagMs === null
        ? lagMs
        : Math.min(lagMs, this.floorLagMs + PLAYOUT_FLOOR_RISE_RATE * Math.max(0, nowMs - this.floorAtMs));
    const windowLagMs = this.leastLagInWindow(nowMs, lagMs);
    this.floorLagMs = windowLagMs === null ? risenLagMs : Math.max(risenLagMs, windowLagMs);
    this.floorAtMs = nowMs;

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

  /** The fractional server tick currently being rendered — for tick-driven visuals drawn in step with the snapshots. */
  renderTick(nowMs: number): number {
    return this.targetTickMs(nowMs) / TICK_MS;
  }

  /**
   * The client's best live estimate of the server's *current* tick — not
   * delayed like {@link renderTick} (that's for what to draw; this is for what
   * the server is *simulating right now*, transit latency included). ADR
   * 0027: the client's own prediction-tick counter is seeded from this (plus
   * a LEAD), once, so its tick numbers share the server's epoch — required
   * for the server to consume `input[serverTick]` instead of FIFO.
   */
  estimatedServerTick(nowMs: number): number {
    return this.estimatedServerTickMs(nowMs) / TICK_MS;
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

  /**
   * Record an arrival and return the least lag of the last
   * {@link PLAYOUT_FLOOR_WINDOW_MS} of them — the playout floor's lower bound —
   * or null when arrivals have not covered that whole span without a gap over
   * {@link PLAYOUT_FLOOR_WINDOW_MAX_GAP_MS}, and the floor is the rise's alone.
   */
  private leastLagInWindow(nowMs: number, lagMs: number): number | null {
    const arrivals = this.arrivals;
    arrivals.push({ atMs: nowMs, lagMs });
    const startMs = nowMs - PLAYOUT_FLOOR_WINDOW_MS;
    while (arrivals.length > 1 && arrivals[1]!.atMs <= startMs) arrivals.shift();
    if (arrivals[0]!.atMs > startMs) return null; // not a whole window of arrivals yet
    let leastMs = Number.POSITIVE_INFINITY;
    for (let i = 1; i < arrivals.length; i += 1) {
      if (arrivals[i]!.atMs - arrivals[i - 1]!.atMs > PLAYOUT_FLOOR_WINDOW_MAX_GAP_MS) return null;
      leastMs = Math.min(leastMs, arrivals[i]!.lagMs);
    }
    return leastMs;
  }

  /** The server-tick time to render at, in ms — the playout clock, `interpDelayMs` behind the arrival floor. */
  private targetTickMs(nowMs: number): number {
    return nowMs - this.slewPlayout(nowMs);
  }

  /**
   * Advance the playout offset to `nowMs` and return it. Idempotent for a
   * repeated `nowMs`, so {@link renderTick} and {@link sample} may both be
   * asked in one frame; the drawn tick time itself is always `nowMs - offset`,
   * exact to the call. Starts on the target at the first frame drawn, so
   * snapshots that queued up before it already count.
   */
  private slewPlayout(nowMs: number): number {
    if (this.floorLagMs === null) return this.delayMs; // nothing received yet — `ready` is false
    const targetMs = this.floorLagMs + this.delayMs;
    if (this.playoutOffsetMs === null) {
      this.playoutOffsetMs = targetMs;
    } else {
      const elapsedMs = Math.max(0, nowMs - this.playoutAtMs);
      const errorMs = targetMs - this.playoutOffsetMs;
      if (Math.abs(errorMs) > PLAYOUT_SNAP_MS) {
        this.playoutOffsetMs = targetMs;
      } else {
        const maxStepMs = PLAYOUT_SLEW_MAX_RATE * elapsedMs;
        const stepMs = errorMs * Math.min(1, elapsedMs / PLAYOUT_SLEW_TIME_MS);
        this.playoutOffsetMs += Math.max(-maxStepMs, Math.min(maxStepMs, stepMs));
      }
    }
    this.playoutAtMs = Math.max(this.playoutAtMs, nowMs);
    return this.playoutOffsetMs;
  }

  /** The live estimate of the server's current tick time (ms), with no render delay subtracted. */
  private estimatedServerTickMs(nowMs: number): number {
    if (this.pingOffsetMs !== null && this.latestServerTimeMs !== null && this.latestTickMs !== null) {
      // server-now (in its own perf clock) minus when the latest snapshot's
      // tick was due (ADR 0109) = real server time elapsed since, transit
      // latency included.
      const elapsedSinceLatest = nowMs + this.pingOffsetMs - this.latestServerTimeMs;
      return this.latestTickMs + elapsedSinceLatest;
    }
    return nowMs - (this.anchorOffsetMs ?? 0);
  }
}
