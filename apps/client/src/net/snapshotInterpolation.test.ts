import type { SimState } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { SnapshotInterpolator } from "./snapshotInterpolation.js";

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
    // unbounded without the ease-toward-observed correction.
    const drifting = Array.from({ length: 400 }, (_, k) => ({
      state: snapshotAtTick(k),
      atMs: k * TICK_MS * 1.005 + 1.5 + 2.5 * Math.abs(Math.sin(k * 1.7)),
    }));
    const rt = Array.from({ length: Math.floor((drifting.at(-1)!.atMs - TICK_MS) / RENDER_MS) }, (_, i) => i * RENDER_MS);
    expect(roughness(frameDeltas(renderBuffered(drifting, rt)))).toBeLessThan(0.15);
  });
});
