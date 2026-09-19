import { PLAYOUT_SLEW_MAX_RATE, type SimState } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { interpDelayMs, SnapshotInterpolator } from "./snapshotInterpolation.js";

/**
 * Feedback loop for "the pushed box isn't smooth" (2026-09 playtest).
 *
 * The bug was not in the physics or the netcode — it was in how `main.ts` turned
 * a stream of server snapshots into a render position: it lerped between the
 * last two *received* snapshots with `alpha = (now - arrivedAt) / TICK_MS`, i.e.
 * it assumed every snapshot arrives exactly one tick after the previous one.
 * Real snapshots don't (a Node `setInterval` fires a few ms late and unevenly;
 * encode + socket + parse add variable delay), so a box moving at a constant
 * speed on the server was drawn moving at a constantly-varying speed.
 *
 * This drives a snapshot stream that moves the box at a *constant* rate but
 * arrives with realistic jitter, through both the old naive interpolation and
 * the new {@link SnapshotInterpolator}, and asserts the new one renders it
 * smoothly (near-constant per-frame displacement).
 */

const TICK_MS = 1000 / 30;
const RENDER_MS = 1000 / 60; // 60 fps
const BOX_STEP = 0.2; // units the box moves per server tick (a steady push)

const snapshotAtTick = (tick: number): SimState => ({
  tick,
  characters: {},
  props: [{ position: { x: tick * BOX_STEP, y: 0.4, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, atRest: false }],
});

interface Arrival {
  state: SimState;
  atMs: number;
}

/**
 * Deterministic stand-in for `setInterval` + network jitter: every snapshot
 * arrives *late* (timers never fire early), by a small amount that varies tick
 * to tick, with a periodic larger hitch. No RNG — a fixed pattern.
 */
const jitteredArrivals = (count: number): Arrival[] =>
  Array.from({ length: count }, (_, k) => ({
    state: snapshotAtTick(k),
    atMs: k * TICK_MS + 1.5 + 2.5 * Math.abs(Math.sin(k * 1.7)) + (k % 7 === 3 ? 9 : 0),
  }));

/** The interpolation `main.ts` did before — extracted verbatim, for the "reproduces the bug" case. */
const renderNaive = (arrivals: Arrival[], renderTimesMs: number[]): number[] => {
  const alphaSince = (receivedAtMs: number, now: number): number =>
    Math.max(0, Math.min(1, (now - receivedAtMs) / TICK_MS));
  let prev: Arrival | null = null;
  let latest: Arrival | null = null;
  let latestAt = 0;
  let next = 0;
  const out: number[] = [];
  for (const now of renderTimesMs) {
    while (next < arrivals.length && arrivals[next]!.atMs <= now) {
      const a = arrivals[next]!;
      prev = latest ?? a;
      latest = a;
      latestAt = a.atMs;
      next += 1;
    }
    if (!latest) {
      out.push(0);
      continue;
    }
    const p = (prev ?? latest).state.props[0]!.position.x;
    const n = latest.state.props[0]!.position.x;
    out.push(p + (n - p) * alphaSince(latestAt, now));
  }
  return out;
};

const renderBuffered = (arrivals: Arrival[], renderTimesMs: number[]): number[] => {
  const interp = new SnapshotInterpolator();
  let next = 0;
  const out: number[] = [];
  for (const now of renderTimesMs) {
    while (next < arrivals.length && arrivals[next]!.atMs <= now) {
      interp.receive(arrivals[next]!.state, arrivals[next]!.atMs);
      next += 1;
    }
    out.push(interp.ready ? interp.sample(now).props[0]!.position.x : 0);
  }
  return out;
};

/** Per-frame displacement of a rendered position stream, from the first frame it's moving. */
const frameDeltas = (rendered: number[]): number[] => {
  const deltas = rendered.slice(1).map((x, i) => x - rendered[i]!);
  const firstMoving = deltas.findIndex((d) => Math.abs(d) > 1e-9);
  return firstMoving < 0 ? [] : deltas.slice(firstMoving);
};

/** How far the worst frame's speed strays from the median frame speed (0 = perfectly smooth). */
const roughness = (deltas: number[]): number => {
  const sorted = deltas.map(Math.abs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.max(...deltas.map((d) => Math.abs(Math.abs(d) - median) / median));
};

describe("client snapshot interpolation — smoothness under realistic arrival jitter", () => {
  const arrivals = jitteredArrivals(120);
  const renderTimes = Array.from(
    { length: Math.floor((arrivals.at(-1)!.atMs - TICK_MS) / RENDER_MS) },
    (_, i) => i * RENDER_MS,
  );

  it("reproduces the bug: the old (naive) interpolation renders a constant-speed box with a jerky speed", () => {
    expect(roughness(frameDeltas(renderNaive(arrivals, renderTimes)))).toBeGreaterThan(0.5);
  });

  it("SnapshotInterpolator renders the same jittery stream smoothly", () => {
    expect(roughness(frameDeltas(renderBuffered(arrivals, renderTimes)))).toBeLessThan(0.1);
  });

  it("holds the latest pose without jumping backward when a snapshot is late (buffer underrun)", () => {
    // One snapshot arrives very late — well past the interp delay (~66.7 ms at 30 Hz).
    const late = jitteredArrivals(20);
    late[12]!.atMs = 12 * TICK_MS + 90;
    const rendered = renderBuffered(late, renderTimes.slice(0, 40));
    const deltas = frameDeltas(rendered);
    // The box may briefly hold (delta ≈ 0) but must never move backward.
    expect(Math.min(...deltas)).toBeGreaterThanOrEqual(-1e-9);
  });

  it("setSnapshotHz widens the playout delay — a 20 Hz stream underruns a 30 Hz-configured buffer, holds after adopting 20", () => {
    const at20 = Array.from({ length: 40 }, (_, k) => ({ state: snapshotAtTick(k * 1.5), atMs: k * (TICK_MS * 1.5) + 3 }));
    // (tick spacing 1.5 stands in for a 20 Hz snapshot rate on a 30 Hz sim.)
    const rt = Array.from({ length: 200 }, (_, i) => i * RENDER_MS);

    const def = new SnapshotInterpolator(); // 30 Hz default → 66.7 ms delay
    const adopted = new SnapshotInterpolator();
    adopted.setSnapshotHz(20); // → 100 ms delay

    let nextD = 0;
    let nextA = 0;
    let defUnderruns = 0;
    let adoptedUnderruns = 0;
    for (const now of rt) {
      while (nextD < at20.length && at20[nextD]!.atMs <= now) def.receive(at20[nextD++]!.state, now);
      while (nextA < at20.length && at20[nextA]!.atMs <= now) adopted.receive(at20[nextA++]!.state, now);
      if (def.ready) {
        def.sample(now);
        if (def.holdingLatest) defUnderruns += 1;
      }
      if (adopted.ready) {
        adopted.sample(now);
        if (adopted.holdingLatest) adoptedUnderruns += 1;
      }
    }
    expect(adoptedUnderruns).toBeLessThan(defUnderruns);
  });

  it("estimatedServerTick tracks the live server tick, undelayed (unlike renderTick)", () => {
    const interp = new SnapshotInterpolator();
    interp.setServerClockOffsetMs(0); // client and server clocks share an epoch, for this test
    const serverTimeMs = 10 * TICK_MS; // the server built the tick-10 snapshot at this server-clock reading
    const arrivedAtMs = serverTimeMs + 5; // 5 ms transit
    interp.receive(snapshotAtTick(10), arrivedAtMs, serverTimeMs);
    const now = arrivedAtMs + 20; // 20 ms later, no new snapshot yet
    // renderTick is interpDelayMs behind; estimatedServerTick is not.
    expect(interp.estimatedServerTick(now)).toBeGreaterThan(interp.renderTick(now));
    expect(interp.estimatedServerTick(now)).toBeCloseTo(10 + 25 / TICK_MS, 3);
  });

  it("stays smooth over a long stream despite local↔server clock drift", () => {
    // Server clock runs 0.5% fast relative to the client's — offset would grow
    // unbounded without the ease-toward-observed correction. (ADR 0109: what
    // is drawn now follows the playout floor, which rises to keep up; the ease
    // is left to `estimatedServerTick`'s fallback. The assertion is unchanged.)
    const drifting = Array.from({ length: 400 }, (_, k) => ({
      state: snapshotAtTick(k),
      atMs: k * TICK_MS * 1.005 + 1.5 + 2.5 * Math.abs(Math.sin(k * 1.7)),
    }));
    const rt = Array.from({ length: Math.floor((drifting.at(-1)!.atMs - TICK_MS) / RENDER_MS) }, (_, i) => i * RENDER_MS);
    expect(roughness(frameDeltas(renderBuffered(drifting, rt)))).toBeLessThan(0.15);
  });
});

/**
 * ADR 0109 — the playout clock. The world used to be drawn `interpDelayMs`
 * behind the server's *current* time (the ping clock), so every millisecond a
 * Snapshot spent in transit came out of the buffer: past ~33 ms one-way it ran
 * dry every Snapshot, held the latest pose, then jumped. It is now drawn behind
 * the least-delayed *arrival*.
 *
 * The stand-in server ticks at a true 30 Hz and stamps each Snapshot 1–4 ms
 * after its step; its `performance.now()` runs {@link SERVER_CLOCK_MS} ahead of
 * the client's. Delivery is in order (a WebSocket is TCP) after a one-way
 * latency plus uniform ±`jitterMs`. Seeded, so every run is the same run.
 */
const SERVER_CLOCK_MS = 123_456.789;
const FIRST_TICK = 900;

interface Delivery {
  state: SimState;
  atMs: number;
  serverTimeMs: number;
}

const seeded = (seed: number) => (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

/** `oneWayMs` gets the local time the Snapshot was sent, so a test can step the latency mid-stream. */
const deliveries = (seconds: number, oneWayMs: (sentAtMs: number) => number, jitterMs = 10): Delivery[] => {
  const rnd = seeded(7);
  const out: Delivery[] = [];
  let lastAtMs = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < seconds * 30; k += 1) {
    const sentAtMs = k * TICK_MS + 1 + 3 * rnd(); // on the client's clock
    const atMs = Math.max(lastAtMs, sentAtMs + oneWayMs(sentAtMs) + (2 * rnd() - 1) * jitterMs);
    lastAtMs = atMs;
    out.push({ state: snapshotAtTick(FIRST_TICK + k), atMs, serverTimeMs: sentAtMs + SERVER_CLOCK_MS });
  }
  return out;
};

interface Frame {
  nowMs: number;
  renderTick: number;
  holding: boolean;
  /** Server time since the newest Snapshot was sent — the old ping clock drew past it once this reached `interpDelayMs`. */
  sinceNewestSentMs: number;
}

/** Draw frames at `fps` the way `frameLoop.ts` does — the ping offset handed over, then `sample` — once the interpolator is ready. */
const play = (
  interp: SnapshotInterpolator,
  stream: Delivery[],
  fps: number,
  untilMs: number,
  pingOffsetMs: (nowMs: number) => number = () => SERVER_CLOCK_MS,
): Frame[] => {
  const frames: Frame[] = [];
  let next = 0;
  for (let nowMs = 0; nowMs < untilMs; nowMs += 1000 / fps) {
    while (next < stream.length && stream[next]!.atMs <= nowMs) {
      const d = stream[next++]!;
      interp.receive(d.state, d.atMs, d.serverTimeMs);
    }
    if (!interp.ready) continue;
    interp.setServerClockOffsetMs(pingOffsetMs(nowMs));
    interp.sample(nowMs);
    const sinceNewestSentMs = nowMs + pingOffsetMs(nowMs) - stream[next - 1]!.serverTimeMs;
    frames.push({ nowMs, renderTick: interp.renderTick(nowMs), holding: interp.holdingLatest, sinceNewestSentMs });
  }
  return frames;
};

/** How fast the drawn world ran over each frame, as a multiple of real time. */
const advances = (frames: Frame[]): number[] =>
  frames.slice(1).map((f, i) => ((f.renderTick - frames[i]!.renderTick) * TICK_MS) / (f.nowMs - frames[i]!.nowMs));

const tickAt = (frames: Frame[], nowMs: number): number => frames.find((f) => f.nowMs >= nowMs)!.renderTick;

describe("client snapshot interpolation — the playout clock counts from arrival, not from the server's now (ADR 0109)", () => {
  it.each([
    [40, 60],
    [50, 60],
    [60, 60],
    [40, 144],
    [50, 144],
    [60, 144],
  ])("a %i ms one-way link with ±10 ms jitter never underruns at %i Hz, and the drawn world keeps real time", (oneWayMs, fps) => {
    const stream = deliveries(14, () => oneWayMs);
    const frames = play(new SnapshotInterpolator(), stream, fps, stream.at(-1)!.atMs);
    const settled = frames.filter((f) => f.nowMs > 2000);

    // The ping clock it replaces would have held the latest pose on some of these frames (6% at 40 ms, most at 60).
    const pingClockHolds = settled.filter((f) => f.sinceNewestSentMs >= interpDelayMs(30)).length;
    expect(pingClockHolds / settled.length).toBeGreaterThan(0.05);

    expect(settled.filter((f) => f.holding)).toHaveLength(0);
    for (const advance of advances(settled)) expect(Math.abs(advance - 1)).toBeLessThan(0.03);
  });

  it("what is drawn no longer reads the ping clock — only estimatedServerTick does", () => {
    const stream = deliveries(6, () => 50);
    const steady = play(new SnapshotInterpolator(), stream, 60, stream.at(-1)!.atMs);
    const wandering = play(new SnapshotInterpolator(), stream, 60, stream.at(-1)!.atMs, (nowMs) => SERVER_CLOCK_MS + 15 * Math.sin(nowMs / 700));
    expect(wandering.map((f) => f.renderTick)).toEqual(steady.map((f) => f.renderTick));
  });

  it("a first Snapshot received 200 ms late is worked off within 2 s — never underrunning, never drawn backwards", () => {
    const onTime = deliveries(6, () => 50);
    // The first Snapshot lands 200 ms late (TCP slow start, a main thread busy
    // building the Stage) and the next six were never sent, so the stream
    // resumes on time right after it — ADR 0019's poisoned anchor.
    const poisoned = [{ ...onTime[0]!, atMs: onTime[0]!.atMs + 200 }, ...onTime.slice(7)];
    const untilMs = onTime.at(-1)!.atMs;
    const frames = play(new SnapshotInterpolator(), poisoned, 60, untilMs);
    const reference = play(new SnapshotInterpolator(), onTime.slice(7), 60, untilMs);
    const firstMs = frames[0]!.nowMs;

    expect((tickAt(reference, firstMs + 100) - tickAt(frames, firstMs + 100)) * TICK_MS).toBeGreaterThan(150);
    expect(Math.abs(tickAt(reference, firstMs + 2000) - tickAt(frames, firstMs + 2000)) * TICK_MS).toBeLessThan(TICK_MS / 3);
    expect(frames.filter((f) => f.holding)).toHaveLength(0);
    for (const advance of advances(frames)) expect(advance).toBeGreaterThan(0);
  });

  it("a +50 ms latency step stops underrunning within 2 s", () => {
    const stepAtMs = 5000;
    const stream = deliveries(12, (sentAtMs) => (sentAtMs < stepAtMs ? 40 : 90));
    const frames = play(new SnapshotInterpolator(), stream, 60, stream.at(-1)!.atMs);

    expect(frames.filter((f) => f.holding && f.nowMs > 2000 && f.nowMs < stepAtMs)).toHaveLength(0);
    const lastHoldMs = frames.filter((f) => f.holding).at(-1)?.nowMs ?? stepAtMs;
    expect(lastHoldMs - stepAtMs).toBeLessThan(2000);
    for (const advance of advances(frames)) expect(advance).toBeGreaterThan(0);
  });

  it("a −50 ms latency step never draws the world backwards, and catches up within 2 s", () => {
    const stepAtMs = 5000;
    const stream = deliveries(12, (sentAtMs) => (sentAtMs < stepAtMs ? 90 : 40));
    const untilMs = stream.at(-1)!.atMs;
    const frames = play(new SnapshotInterpolator(), stream, 144, untilMs);
    // The same Snapshots over a link that was always 40 ms: where it should end up.
    const reference = play(new SnapshotInterpolator(), deliveries(12, () => 40), 144, untilMs);

    for (const advance of advances(frames)) {
      expect(advance).toBeGreaterThan(0);
      expect(advance).toBeLessThanOrEqual(1 + PLAYOUT_SLEW_MAX_RATE + 1e-9);
    }
    expect(frames.filter((f) => f.holding && f.nowMs > 2000)).toHaveLength(0);
    expect(Math.abs(tickAt(reference, stepAtMs + 2000) - tickAt(frames, stepAtMs + 2000)) * TICK_MS).toBeLessThan(TICK_MS / 3);
  });

  // A step up in lag larger than the headroom — a Wi-Fi roam, a route change,
  // a server stall its scheduler forgave. The floor's own rise follows it at
  // PLAYOUT_FLOOR_RISE_RATE, which held the latest pose for 3 s after +100 ms
  // and ~10 s after +300 ms; the least lag of the last second of arrivals now
  // bounds it from below.
  it("a +100 ms latency step stops underrunning within 1.5 s, never drawing the world backwards", () => {
    const stepAtMs = 5000;
    const stream = deliveries(12, (sentAtMs) => (sentAtMs < stepAtMs ? 40 : 140));
    const frames = play(new SnapshotInterpolator(), stream, 60, stream.at(-1)!.atMs);

    expect(frames.filter((f) => f.holding && f.nowMs > 2000 && f.nowMs < stepAtMs)).toHaveLength(0);
    const lastHoldMs = frames.filter((f) => f.holding).at(-1)?.nowMs ?? stepAtMs;
    expect(lastHoldMs - stepAtMs).toBeLessThan(1500);
    for (const advance of advances(frames)) expect(advance).toBeGreaterThan(0);
  });

  it("a +300 ms latency step stops underrunning within 1.5 s, through one backward jump", () => {
    const stepAtMs = 5000;
    const stream = deliveries(12, (sentAtMs) => (sentAtMs < stepAtMs ? 40 : 340));
    const frames = play(new SnapshotInterpolator(), stream, 60, stream.at(-1)!.atMs);

    const lastHoldMs = frames.filter((f) => f.holding).at(-1)?.nowMs ?? stepAtMs;
    expect(lastHoldMs - stepAtMs).toBeLessThan(1500);
    // Past PLAYOUT_SNAP_MS the clock jumps rather than slewing for seconds —
    // once, back by the step less what the floor had already risen.
    const backward = advances(frames).filter((advance) => advance <= 0);
    expect(backward).toHaveLength(1);
  });

  it("the burst that lands when a 1.5 s transport stall clears never draws the world backwards", () => {
    // Everything sent in the stall arrives at once when it clears, 2 ms apart
    // and still in order, so frames land in the middle of the burst — where
    // its first Snapshots, lagging by up to the whole stall, are nearly all a
    // window would hold.
    const stallFromMs = 5000;
    const clearsAtMs = stallFromMs + 1540;
    let lastAtMs = Number.NEGATIVE_INFINITY;
    const stream = deliveries(12, () => 40).map((d) => {
      lastAtMs = d.serverTimeMs - SERVER_CLOCK_MS < stallFromMs ? d.atMs : Math.max(d.atMs, clearsAtMs, lastAtMs + 2);
      return { ...d, atMs: lastAtMs };
    });
    const burstEndsAtMs = stream.filter((d) => d.serverTimeMs - SERVER_CLOCK_MS < clearsAtMs).at(-1)!.atMs;
    for (const fps of [60, 144]) {
      const frames = play(new SnapshotInterpolator(), stream, fps, stream.at(-1)!.atMs);
      expect(frames.filter((f) => f.nowMs > clearsAtMs && f.nowMs < burstEndsAtMs).length).toBeGreaterThan(1);
      for (const advance of advances(frames)) expect(advance).toBeGreaterThan(0);
      expect(frames.filter((f) => f.holding && f.nowMs > burstEndsAtMs)).toHaveLength(0);
    }
  });
});
