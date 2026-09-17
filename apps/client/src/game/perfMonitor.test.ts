import { describe, expect, it } from "vitest";
import { PerfMonitor, type PerfContext, type PerfFrame, type RenderStats } from "./perfMonitor.js";

const RENDER: RenderStats = { calls: 150, triangles: 90_000, geometries: 40, textures: 30, programs: 12 };

const frameAt = (nowMs: number, overrides: Partial<PerfFrame> = {}): PerfFrame => ({
  nowMs,
  frameMs: 16,
  simMs: 0.5,
  simSteps: 1,
  renderCpuMs: 2,
  render: RENDER,
  focus: { x: 0, y: 0, z: -10 },
  ...overrides,
});

const CONTEXT: PerfContext = {
  capturedAt: "2026-09-17T00:00:00.000Z",
  mode: "practice",
  trackId: "base-race",
  userAgent: "test",
  devicePixelRatio: 2,
  canvas: { width: 2000, height: 1000, cssWidth: 1000, cssHeight: 500 },
  hardwareConcurrency: 8,
  heapUsedMb: null,
  assetFiles: 33,
  assetBytes: 4_900_000,
};

describe("PerfMonitor (M13 ticket 01)", () => {
  it("starts its clocks on the first frame without counting it", () => {
    const perf = new PerfMonitor();
    perf.frame(frameAt(1000, { frameMs: 999 }));
    const view = perf.view();
    expect(view.run.frames).toBe(0);
    expect(view.window).toBeNull();
    expect(view.render).toEqual(RENDER);
  });

  it("closes a window once it is old enough, and shows only that window", () => {
    const perf = new PerfMonitor({ windowMs: 100 });
    perf.frame(frameAt(0));
    perf.frame(frameAt(50, { frameMs: 50 }));
    expect(perf.view().window).toBeNull();
    perf.frame(frameAt(100, { frameMs: 50 }));
    const first = perf.view().window!;
    expect(first.frames).toBe(2);
    expect(first.frameMs.maxMs).toBe(50);

    perf.frame(frameAt(150, { frameMs: 10 }));
    perf.frame(frameAt(200, { frameMs: 10 }));
    const second = perf.view().window!;
    expect(second.frames).toBe(2);
    expect(second.frameMs.maxMs).toBe(10);
    expect(perf.view().run.frames).toBe(4);
  });

  it("counts frames over each budget across the run", () => {
    const perf = new PerfMonitor();
    perf.frame(frameAt(0));
    for (const [i, frameMs] of [16, 18, 34, 51, 70].entries()) perf.frame(frameAt(100 * (i + 1), { frameMs }));
    // over 17, over 33, over 50
    expect(perf.view().run.over).toEqual([4, 3, 2]);
  });

  it("charges a reconcile's replay to the next frame, and counts corrections", () => {
    const perf = new PerfMonitor({ windowMs: 1_000_000 });
    perf.frame(frameAt(0));
    perf.reconcile(1.5, 4, true);
    perf.reconcile(0.2, 0, false);
    perf.reconcile(1.0, 2, true);
    perf.frame(frameAt(16));
    perf.frame(frameAt(32));
    const run = perf.summary(CONTEXT).run;
    expect(run.replayedTicks).toBe(6);
    expect(run.replayedTicksMaxPerFrame).toBe(6);
    expect(run.corrections).toBe(2);
    expect(run.reconcileMs.count).toBe(3);
    expect(run.reconcileMs.maxMs).toBe(1.5);
  });

  it("does not charge a replay from before the first frame", () => {
    const perf = new PerfMonitor();
    perf.reconcile(1, 5, true);
    perf.frame(frameAt(0));
    perf.frame(frameAt(16));
    expect(perf.summary(CONTEXT).run.replayedTicks).toBe(0);
  });

  it("reports corrections per minute over the run's own length", () => {
    const perf = new PerfMonitor();
    perf.frame(frameAt(0));
    perf.reconcile(0.1, 1, true);
    perf.reconcile(0.1, 1, true);
    perf.frame(frameAt(30_000));
    const run = perf.summary(CONTEXT).run;
    expect(run.seconds).toBe(30);
    expect(run.correctionsPerMinute).toBe(4);
  });

  it("keeps the busiest render seen alongside the latest", () => {
    const perf = new PerfMonitor();
    perf.frame(frameAt(0, { render: { ...RENDER, calls: 300, triangles: 250_000 } }));
    perf.frame(frameAt(16, { render: RENDER }));
    const render = perf.summary(CONTEXT).run.render;
    expect(render.calls).toBe(150);
    expect(render.maxCalls).toBe(300);
    expect(render.maxTriangles).toBe(250_000);
  });

  it("does not keep a reference to the render stats it was handed", () => {
    const perf = new PerfMonitor();
    const reused = { ...RENDER };
    perf.frame(frameAt(0, { render: reused }));
    reused.calls = 1;
    expect(perf.view().render.calls).toBe(150);
  });

  it("groups frames by the cell the camera looked at, in the order first reached", () => {
    const perf = new PerfMonitor({ cellM: 50 });
    perf.frame(frameAt(0));
    perf.frame(frameAt(16, { focus: { x: 1, y: 3, z: -10 }, frameMs: 16 }));
    perf.frame(frameAt(32, { focus: { x: 2, y: 0, z: -60 }, frameMs: 40, render: { ...RENDER, triangles: 200_000 } }));
    perf.frame(frameAt(48, { focus: { x: 3, y: 0, z: -20 }, frameMs: 20 }));
    const cells = perf.summary(CONTEXT).cells;
    expect(cells.map((cell) => ({ x: cell.x, z: cell.z, frames: cell.frames }))).toEqual([
      { x: [0, 50], z: [-50, 0], frames: 2 },
      { x: [0, 50], z: [-100, -50], frames: 1 },
    ]);
    expect(cells[1]!.frameMs.maxMs).toBe(40);
    expect(cells[1]!.maxTriangles).toBe(200_000);
  });

  it("carries the load times and the context into the summary", () => {
    const perf = new PerfMonitor();
    perf.booted(4200);
    perf.trackLoaded(800);
    const summary = perf.summary(CONTEXT);
    expect(summary.kind).toBe("dontfall-perf/1");
    expect(summary.load).toEqual({ bootMs: 4200, lastTrackLoadMs: 800 });
    expect(summary.context).toBe(CONTEXT);
    expect(summary.run.frames).toBe(0);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});
