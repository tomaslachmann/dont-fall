import { DurationHistogram, type DurationSummary, type Vec3 } from "@dont-fall/shared";

/**
 * What a frame costs, over a run (M13 ticket 01). Pure bookkeeping — no DOM,
 * no three.js: the game hands it one {@link PerfFrame} per rendered frame and
 * one call per reconcile, the overlay reads {@link PerfMonitor.view}, and a
 * recorded run is {@link PerfMonitor.summary}. Only constructed when the
 * player asked for the overlay; a normal session never samples anything.
 */

/** What `renderer.info` said after this frame's render. */
export interface RenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface PerfFrame {
  /** The `requestAnimationFrame` timestamp. */
  nowMs: number;
  /** Time since the previous frame. */
  frameMs: number;
  /** CPU time of this frame's prediction steps. */
  simMs: number;
  simSteps: number;
  /** CPU time of `stage.render()` — what the GPU does afterwards is not in it. */
  renderCpuMs: number;
  render: RenderStats;
  /** Where the camera is looking: the section of Track this frame drew. */
  focus: Vec3;
}

/** Frames over one 60 Hz budget, over one 30 Hz budget, and a visible stutter. */
export const FRAME_THRESHOLDS_MS = [17, 33, 50] as const;
/** How long the overlay's rolling window is. */
export const PERF_WINDOW_MS = 2000;
/** Side of the square cells a run's frames are grouped by, in metres on X/Z. */
export const PERF_CELL_M = 50;

const frameHistogram = (): DurationHistogram =>
  new DurationHistogram({ binMs: 0.1, rangeMs: 250, thresholdsMs: FRAME_THRESHOLDS_MS });
const workHistogram = (): DurationHistogram => new DurationHistogram({ binMs: 0.05, rangeMs: 100 });

/** One span of frames: the rolling window, or the whole run. */
class FrameSpan {
  readonly frame = frameHistogram();
  readonly sim = workHistogram();
  readonly renderCpu = workHistogram();
  readonly reconcile = workHistogram();
  simStepsMax = 0;
  replayedTicks = 0;
  replayedMaxPerFrame = 0;
  corrections = 0;

  addFrame(frame: PerfFrame, replayedTicks: number): void {
    this.frame.record(frame.frameMs);
    this.sim.record(frame.simMs);
    this.renderCpu.record(frame.renderCpuMs);
    this.simStepsMax = Math.max(this.simStepsMax, frame.simSteps);
    this.replayedTicks += replayedTicks;
    this.replayedMaxPerFrame = Math.max(this.replayedMaxPerFrame, replayedTicks);
  }

  addReconcile(durationMs: number, corrected: boolean): void {
    this.reconcile.record(durationMs);
    if (corrected) this.corrections += 1;
  }

  reset(): void {
    this.frame.reset();
    this.sim.reset();
    this.renderCpu.reset();
    this.reconcile.reset();
    this.simStepsMax = 0;
    this.replayedTicks = 0;
    this.replayedMaxPerFrame = 0;
    this.corrections = 0;
  }

  summary(durationMs: number): SpanSummary {
    return {
      seconds: durationMs / 1000,
      frames: this.frame.count,
      frameMs: this.frame.summary(),
      simMs: this.sim.summary(),
      renderCpuMs: this.renderCpu.summary(),
      reconcileMs: this.reconcile.summary(),
      simStepsMax: this.simStepsMax,
      replayedTicks: this.replayedTicks,
      replayedTicksMaxPerFrame: this.replayedMaxPerFrame,
      corrections: this.corrections,
      correctionsPerMinute: durationMs > 0 ? (this.corrections * 60_000) / durationMs : 0,
    };
  }
}

export interface SpanSummary {
  seconds: number;
  frames: number;
  frameMs: DurationSummary;
  simMs: DurationSummary;
  renderCpuMs: DurationSummary;
  reconcileMs: DurationSummary;
  simStepsMax: number;
  replayedTicks: number;
  replayedTicksMaxPerFrame: number;
  corrections: number;
  correctionsPerMinute: number;
}

interface Cell {
  x: number;
  z: number;
  frame: DurationHistogram;
  maxCalls: number;
  maxTriangles: number;
}

export interface CellSummary {
  /** The cell's extent in metres, `[min, max)`. */
  x: [number, number];
  z: [number, number];
  frames: number;
  frameMs: DurationSummary;
  maxCalls: number;
  maxTriangles: number;
}

/** What the overlay draws. */
export interface PerfView {
  /** The last complete window, or `null` before one has closed. */
  window: SpanSummary | null;
  /** The latest frame's `renderer.info`. */
  render: RenderStats;
  run: { seconds: number; frames: number; over: number[] };
}

/** The environment a run was taken in — read by the caller, which owns the DOM. */
export interface PerfContext {
  capturedAt: string;
  mode: "match" | "practice";
  trackId: string | null;
  userAgent: string;
  devicePixelRatio: number;
  canvas: { width: number; height: number; cssWidth: number; cssHeight: number };
  hardwareConcurrency: number | null;
  heapUsedMb: number | null;
  assetFiles: number;
  assetBytes: number;
}

export interface PerfSummary {
  kind: "dontfall-perf/1";
  context: PerfContext;
  load: { bootMs: number | null; lastTrackLoadMs: number | null };
  run: SpanSummary & { render: RenderStats & { maxCalls: number; maxTriangles: number } };
  /** Cells in the order the run first reached them. */
  cells: CellSummary[];
}

export class PerfMonitor {
  private readonly windowMs: number;
  private readonly cellM: number;
  private readonly run = new FrameSpan();
  private readonly window = new FrameSpan();
  private lastWindow: SpanSummary | null = null;
  private runStartedAt: number | null = null;
  private windowStartedAt: number | null = null;
  private lastFrameAt = 0;
  /** Copied into, never replaced — the caller may reuse the object it hands in. */
  private readonly latestRender: RenderStats = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
  private maxCalls = 0;
  private maxTriangles = 0;
  private pendingReplayed = 0;
  private readonly cells = new Map<string, Cell>();
  private bootMs: number | null = null;
  private lastTrackLoadMs: number | null = null;

  constructor({ windowMs = PERF_WINDOW_MS, cellM = PERF_CELL_M }: { windowMs?: number; cellM?: number } = {}) {
    this.windowMs = windowMs;
    this.cellM = cellM;
  }

  frame(frame: PerfFrame): void {
    // The first frame has no previous one to measure from; it only starts the clocks.
    if (this.runStartedAt === null || this.windowStartedAt === null) {
      this.runStartedAt = frame.nowMs;
      this.windowStartedAt = frame.nowMs;
      this.lastFrameAt = frame.nowMs;
      this.pendingReplayed = 0;
      this.observeRender(frame.render);
      return;
    }
    // A reconcile lands between frames; the frame after it is the one that paid.
    const replayed = this.pendingReplayed;
    this.pendingReplayed = 0;
    this.run.addFrame(frame, replayed);
    this.window.addFrame(frame, replayed);
    this.observeRender(frame.render);
    this.lastFrameAt = frame.nowMs;

    const cellX = Math.floor(frame.focus.x / this.cellM);
    const cellZ = Math.floor(frame.focus.z / this.cellM);
    const key = `${cellX},${cellZ}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { x: cellX, z: cellZ, frame: frameHistogram(), maxCalls: 0, maxTriangles: 0 };
      this.cells.set(key, cell);
    }
    cell.frame.record(frame.frameMs);
    cell.maxCalls = Math.max(cell.maxCalls, frame.render.calls);
    cell.maxTriangles = Math.max(cell.maxTriangles, frame.render.triangles);

    if (frame.nowMs - this.windowStartedAt >= this.windowMs) {
      this.lastWindow = this.window.summary(frame.nowMs - this.windowStartedAt);
      this.window.reset();
      this.windowStartedAt = frame.nowMs;
    }
  }

  /** One `PredictionLoop.reconcile` call, however it ended. */
  reconcile(durationMs: number, replayedTicks: number, corrected: boolean): void {
    this.pendingReplayed += replayedTicks;
    this.run.addReconcile(durationMs, corrected);
    this.window.addReconcile(durationMs, corrected);
  }

  /** From the start of the game's boot to its first frame. */
  booted(bootMs: number): void {
    this.bootMs = bootMs;
  }

  /** A live Track swap, from noticing it to the rebuilt Stage. */
  trackLoaded(durationMs: number): void {
    this.lastTrackLoadMs = durationMs;
  }

  view(): PerfView {
    const run = this.run.frame.summary();
    return {
      window: this.lastWindow,
      render: { ...this.latestRender },
      run: { seconds: this.runSeconds(), frames: run.count, over: run.over },
    };
  }

  summary(context: PerfContext): PerfSummary {
    const durationMs = this.runStartedAt === null ? 0 : this.lastFrameAt - this.runStartedAt;
    return {
      kind: "dontfall-perf/1",
      context,
      load: { bootMs: this.bootMs, lastTrackLoadMs: this.lastTrackLoadMs },
      run: {
        ...this.run.summary(durationMs),
        render: { ...this.latestRender, maxCalls: this.maxCalls, maxTriangles: this.maxTriangles },
      },
      cells: [...this.cells.values()].map((cell) => ({
        x: [cell.x * this.cellM, (cell.x + 1) * this.cellM],
        z: [cell.z * this.cellM, (cell.z + 1) * this.cellM],
        frames: cell.frame.count,
        frameMs: cell.frame.summary(),
        maxCalls: cell.maxCalls,
        maxTriangles: cell.maxTriangles,
      })),
    };
  }

  private observeRender(render: RenderStats): void {
    Object.assign(this.latestRender, render);
    this.maxCalls = Math.max(this.maxCalls, render.calls);
    this.maxTriangles = Math.max(this.maxTriangles, render.triangles);
  }

  private runSeconds(): number {
    return this.runStartedAt === null ? 0 : (this.lastFrameAt - this.runStartedAt) / 1000;
  }
}
