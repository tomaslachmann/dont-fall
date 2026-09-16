import type { Module, Segment, Track } from "@dont-fall/shared";

/**
 * The one definition of the course language (ADR 0068) — Start, Checkpoint,
 * Finish — for the inspector, the run-order strip and the 3D markers alike.
 * Deliberately clear of the Impact colours' meanings: Start is the kit's go
 * green, a Checkpoint the brand purple with its number, Finish the racing
 * checker in ink — and each always carries its word or number, never colour
 * alone.
 */
export const COURSE = {
  start: { word: "START", glyph: "▶", color: "var(--df-color-go)", ink: "var(--df-color-go-ink)", hex: "#2FD9A0", inkHex: "#0E4736" },
  checkpoint: { word: "CHECKPOINT", glyph: "◎", color: "var(--df-color-brand)", ink: "#ffffff", hex: "#7B3FE4", inkHex: "#ffffff" },
  finish: { word: "FINISH", glyph: "⚑", color: "var(--df-color-ink)", ink: "#ffffff", hex: "#2B1B4D", inkHex: "#ffffff" },
  /** A Checkpoint with nowhere to respawn. */
  problem: { hex: "#FF5DA2", inkHex: "#ffffff" },
  /** A hoop or an arch that isn't a Checkpoint yet. */
  idle: { hex: "#2B1B4D" },
} as const;

export interface CourseSummary {
  /** The Start Segment, or `undefined` — the Track starts on its first Segment. */
  start: number | undefined;
  /** Checkpoint gates in run order. */
  checkpoints: { index: number; order: number }[];
  /** Every placed finish sign. */
  finishes: number[];
}

/** What a hoop, an arch or a finish sign is on this Track. */
export const gateRoleOf = (segment: Segment, modules: Record<string, Module>): "checkpoint" | "finish" | undefined =>
  modules[segment.moduleId]?.gate?.role;

export const courseOf = (track: Track, modules: Record<string, Module>): CourseSummary => ({
  start: (() => {
    const index = track.findIndex((segment) => segment.start === true);
    return index === -1 ? undefined : index;
  })(),
  checkpoints: track
    .flatMap((segment, index) =>
      segment.checkpoint && gateRoleOf(segment, modules) === "checkpoint" ? [{ index, order: segment.checkpoint.order }] : [],
    )
    .sort((a, b) => a.order - b.order || a.index - b.index),
  finishes: track.flatMap((segment, index) => (gateRoleOf(segment, modules) === "finish" ? [index] : [])),
});

/**
 * Why a Segment may not move (ADR 0068), or `undefined` when it may: a Start,
 * a Checkpoint and a finish sign are resolved from where they rest.
 */
export const motionLockReason = (segment: Segment, modules: Record<string, Module>): string | undefined => {
  if (segment.start) return "The Start stays still — players spawn on it.";
  if (segment.checkpoint && gateRoleOf(segment, modules) === "checkpoint") return "A Checkpoint stays still — switch it off to add Motion.";
  if (gateRoleOf(segment, modules) === "finish") return "A finish sign stays still.";
  return undefined;
};
