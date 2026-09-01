import { interpolateState, TICK_MS, type RenderState, type SimState } from "@dont-fall/shared";

/**
 * How far behind "now" (in server time) the client renders everything it does
 * not predict — Props, other players, this player's own ragdoll. One and a half
 * ticks: enough that the two snapshots bracketing the render moment have
 * essentially always arrived despite `setInterval` firing late and unevenly and
 * the socket adding variable delay, without adding more visible latency than
 * ADR 0003 already prices in.
 */
export const INTERP_DELAY_MS = TICK_MS * 1.5;

/** How quickly the local↔server clock offset eases toward each fresh observation (per snapshot). */
const OFFSET_EASE = 0.02;
/** Keep the buffer bounded on a long session. */
const MAX_BUFFERED = 64;

interface Buffered {
  /** Server time this snapshot represents — `tick * TICK_MS`, perfectly spaced regardless of when it landed. */
  serverMs: number;
  state: SimState;
}

/**
 * Turns a jittery stream of server snapshots into a smooth render state.
 *
 * `main.ts` used to lerp between the last two *received* snapshots with
 * `alpha = (now - arrivedAt) / TICK_MS` — which assumes every snapshot arrives
 * exactly one tick after the last. They don't (a Node `setInterval` fires a few
 * ms late and unevenly; encode + socket + parse add variable delay), so a box
 * pushed at a constant speed on the server was drawn with a constantly-varying
 * speed: too fast when two arrivals were < a tick apart, frozen when they were
 * more than a tick apart.
 *
 * This buffers snapshots keyed by their *server* time, anchors the local clock
 * to the server clock once, and every frame renders the world where it was
 * {@link INTERP_DELAY_MS} of server time ago — lerping between the two buffered
 * snapshots that bracket that moment. The render clock advances by real elapsed
 * wall-clock, so the output speed is constant no matter how unevenly snapshots
 * land (the classic snapshot-interpolation buffer — Fiedler, Valve `cl_interp`).
 */
export class SnapshotInterpolator {
  private readonly buffer: Buffered[] = [];
  /** `localNow - serverMs` for the stream — set on the first snapshot, then eased for clock drift. */
  private offsetMs: number | null = null;

  /** Feed a freshly received snapshot. `nowMs` is `performance.now()` at receipt. */
  receive(state: SimState, nowMs: number): void {
    const serverMs = state.tick * TICK_MS;
    const last = this.buffer.at(-1);
    if (last && serverMs <= last.serverMs) return; // out of order or duplicate — ignore

    const observedOffset = nowMs - serverMs;
    this.offsetMs = this.offsetMs === null ? observedOffset : this.offsetMs + (observedOffset - this.offsetMs) * OFFSET_EASE;

    this.buffer.push({ serverMs, state });
    while (this.buffer.length > MAX_BUFFERED) this.buffer.shift();
  }

  /** Whether a render state is available yet (at least one snapshot received). */
  get ready(): boolean {
    return this.offsetMs !== null && this.buffer.length > 0;
  }

  /** The fractional server tick currently being rendered — for tick-driven visuals (Spinner phase). */
  renderTick(nowMs: number): number {
    return this.targetServerMs(nowMs) / TICK_MS;
  }

  /** The interpolated render state for wall-clock `nowMs`. Call {@link ready} first. */
  sample(nowMs: number): RenderState {
    const target = this.targetServerMs(nowMs);
    const buf = this.buffer;

    if (target <= buf[0]!.serverMs) return interpolateState(buf[0]!.state, buf[0]!.state, 0);
    const last = buf.at(-1)!;
    if (target >= last.serverMs) return interpolateState(last.state, last.state, 1); // buffer underrun — hold the latest

    for (let i = 1; i < buf.length; i += 1) {
      const hi = buf[i]!;
      if (hi.serverMs >= target) {
        const lo = buf[i - 1]!;
        const frac = (target - lo.serverMs) / (hi.serverMs - lo.serverMs);
        // Prune snapshots now safely behind the render target.
        if (i > 2) this.buffer.splice(0, i - 2);
        return interpolateState(lo.state, hi.state, frac);
      }
    }
    return interpolateState(last.state, last.state, 1);
  }

  private targetServerMs(nowMs: number): number {
    return nowMs - (this.offsetMs ?? 0) - INTERP_DELAY_MS;
  }
}
