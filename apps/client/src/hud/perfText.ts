import type { PerfView } from "../game/perfMonitor.js";

/** The key that copies a recorded run (M13 ticket 01), beside the panel's button. */
export const PERF_COPY_KEY = "F8";

const ms = (value: number): string => value.toFixed(value >= 10 ? 1 : 2);

const count = (value: number): string => (value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : String(value));

/** What the overlay shows of the sound (M14 ticket 13). */
export interface PerfAudio {
  voices: number;
  loopsPlaying: number;
  /** Plays the budget skipped as too quiet in the last second… */
  inaudiblePerSecond: number;
  /** …and refused or cut for the one-shot cap. */
  overCapPerSecond: number;
  decodedBytes: number;
}

/** The overlay's sound line: what plays, what the budget turned away, and what the decoded files hold. */
export const formatAudioLine = (audio: PerfAudio): string =>
  `audio  ${audio.voices} voices · ${audio.loopsPlaying} loops · dropped/s ${audio.inaudiblePerSecond} quiet, ` +
  `${audio.overCapPerSecond} over cap · ` +
  `${(audio.decodedBytes / (1024 * 1024)).toFixed(1)} MB decoded`;

/** The overlay's text block (M13 ticket 01): the last closed window, the latest render, the run so far. */
export const formatPerfText = (view: PerfView, audio: PerfAudio | null = null): string => {
  const { window, render, run } = view;
  const lines = ["perf · last window"];
  if (window === null) {
    lines.push("frame  collecting…");
  } else {
    const f = window.frameMs;
    lines.push(
      `frame  p50 ${ms(f.p50Ms)}  p95 ${ms(f.p95Ms)}  p99 ${ms(f.p99Ms)}  max ${ms(f.maxMs)} ms · over 17/33/50: ${f.over.join("/")}`,
      `sim    p95 ${ms(window.simMs.p95Ms)} ms · steps ≤${window.simStepsMax} · replay ≤${window.replayedTicksMaxPerFrame} ticks` +
        ` · reconcile p95 ${ms(window.reconcileMs.p95Ms)} ms · ${window.correctionsPerMinute.toFixed(0)} corr/min`,
      `render cpu p95 ${ms(window.renderCpuMs.p95Ms)} ms`,
    );
  }
  lines.push(
    `gpu    ${render.calls} calls · ${count(render.triangles)} tris · ${render.geometries} geo · ${render.textures} tex · ${render.programs} prog`,
    `run    ${run.seconds.toFixed(0)} s · ${run.frames} frames · over 17/33/50: ${run.over.join("/")}`,
  );
  if (audio) lines.push(formatAudioLine(audio));
  return lines.join("\n");
};
