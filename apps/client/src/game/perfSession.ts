import type { Vec3 } from "@dont-fall/shared";
import { createPerfOverlay } from "../hud/perfOverlay.js";
import { formatPerfText, type PerfAudio } from "../hud/perfText.js";
import type { Stage } from "../render/scene.js";
import { PerfMonitor, type PerfContext, type PerfSummary, type RenderStats } from "./perfMonitor.js";

/**
 * The performance overlay's glue (M13 ticket 01): a {@link PerfMonitor} fed
 * from the frame loop, its panel, the copy key, and the context only a
 * browser can read. Both boots (Match and practice) create one only when the
 * overlay was asked for, so a normal session never pays for any of it.
 */
export interface PerfSession {
  /** Once per rendered frame, after `stage.render()`. */
  frame: (nowMs: number, frameMs: number, simMs: number, simSteps: number, renderCpuMs: number, focus: Vec3) => void;
  /** Once per `PredictionLoop.reconcile` call. */
  reconcile: (durationMs: number, result: { replayedTicks: number; corrected: boolean }) => void;
  /** A live Track swap finished rebuilding. */
  trackLoaded: (durationMs: number) => void;
  dispose: () => void;
}

export interface PerfSessionOptions {
  mount: HTMLElement;
  mode: PerfContext["mode"];
  /** `performance.now()` when the boot began — the first frame closes the load time. */
  bootStartedAt: number;
  /** The live Stage; a Track swap replaces it. */
  stage: () => Pick<Stage, "domElement" | "readRenderStats">;
  trackId: () => string | null;
  fetchStats: () => { files: number; bytes: number };
  /**
   * The live sound engine's counters and the decoded audio's size (M14
   * ticket 13); `null` or absent while there is no sound.
   */
  audio?: () => { voices: number; loopsPlaying: number; inaudible: number; overCap: number; decodedBytes: number } | null;
}

/** How far back the overlay counts the budget's drops (ms). */
const DROPS_WINDOW_MS = 1000;

/** How often the panel's text is rebuilt. */
const TEXT_EVERY_MS = 250;

declare global {
  interface Window {
    /** The recorded run while the overlay is up (M13 ticket 01) — for a console or a scripted browser. */
    dontfallPerfSummary?: () => PerfSummary;
  }
}

export const createPerfSession = (options: PerfSessionOptions): PerfSession => {
  const monitor = new PerfMonitor();
  // Reused every frame: the overlay should not add garbage to what it measures.
  const render: RenderStats = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
  const frame = { nowMs: 0, frameMs: 0, simMs: 0, simSteps: 0, renderCpuMs: 0, render, focus: { x: 0, y: 0, z: 0 } };
  let booted = false;
  let textAt = -Infinity;
  /** The drop counter as it stood at recent text updates, for a per-second rate. */
  const drops: { atMs: number; inaudible: number; overCap: number }[] = [];
  const audioAt = (nowMs: number): PerfAudio | null => {
    const now = options.audio?.();
    if (!now) return null;
    drops.push({ atMs: nowMs, inaudible: now.inaudible, overCap: now.overCap });
    while (drops.length > 1 && nowMs - drops[0]!.atMs > DROPS_WINDOW_MS) drops.shift();
    return {
      voices: now.voices,
      loopsPlaying: now.loopsPlaying,
      inaudiblePerSecond: Math.max(0, now.inaudible - drops[0]!.inaudible),
      overCapPerSecond: Math.max(0, now.overCap - drops[0]!.overCap),
      decodedBytes: now.decodedBytes,
    };
  };

  const context = (): PerfContext => {
    const canvas = options.stage().domElement;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const assets = options.fetchStats();
    return {
      capturedAt: new Date().toISOString(),
      mode: options.mode,
      trackId: options.trackId(),
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      canvas: { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight },
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      heapUsedMb: memory ? memory.usedJSHeapSize / (1024 * 1024) : null,
      assetFiles: assets.files,
      assetBytes: assets.bytes,
    };
  };
  const summary = (): PerfSummary => monitor.summary(context());

  const overlay = createPerfOverlay(options.mount, () => {
    const json = JSON.stringify(summary(), null, 2);
    console.info(`DON'T FALL perf summary\n${json}`);
    overlay.flash("summary logged to the console");
    // Clipboard needs a focused, secure page; the console copy above is the fallback.
    navigator.clipboard?.writeText(json).then(
      () => overlay.flash("summary copied"),
      () => {},
    );
  });
  window.dontfallPerfSummary = summary;

  return {
    frame: (nowMs, frameMs, simMs, simSteps, renderCpuMs, focus) => {
      if (!booted) {
        booted = true;
        monitor.booted(nowMs - options.bootStartedAt);
      }
      options.stage().readRenderStats(render);
      frame.nowMs = nowMs;
      frame.frameMs = frameMs;
      frame.simMs = simMs;
      frame.simSteps = simSteps;
      frame.renderCpuMs = renderCpuMs;
      frame.focus.x = focus.x;
      frame.focus.y = focus.y;
      frame.focus.z = focus.z;
      monitor.frame(frame);
      if (nowMs - textAt >= TEXT_EVERY_MS) {
        textAt = nowMs;
        overlay.setText(formatPerfText(monitor.view(), audioAt(nowMs)));
      }
    },
    reconcile: (durationMs, result) => monitor.reconcile(durationMs, result.replayedTicks, result.corrected),
    trackLoaded: (durationMs) => monitor.trackLoaded(durationMs),
    dispose: () => {
      overlay.dispose();
      if (window.dontfallPerfSummary === summary) delete window.dontfallPerfSummary;
    },
  };
};
