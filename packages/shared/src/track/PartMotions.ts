import { invalidMotionReason, type SegmentMotion } from "./Motion.js";
import type { Module } from "./Module.js";
import type { Track } from "./Track.js";

/**
 * A Motion per moving Part of a parted Asset, keyed by the Part's name
 * (CONTEXT.md: Attachment, ADR 0124) — the three arms of one sweeper, each
 * with its own speed, direction and Ramp.
 */
export type PartMotions = Record<string, SegmentMotion>;

/**
 * The Parts of `module` a {@link PartMotions} entry may address: the moving
 * ones a Motion actually poses. A Shooter's aiming Parts are not among them
 * (ADR 0119): their sweep is the Shooter's own.
 */
export const motionPartNames = (module: Module): string[] =>
  (module.parts ?? []).filter((part) => part.role === "moving" && part.aim === undefined).map((part) => part.name);

/**
 * Why `value` is not a storable {@link PartMotions}, or `undefined` when it
 * is — its shape alone. Whether each key names a real Part needs the Asset,
 * which is {@link invalidPartMotionsTargetReason}'s.
 */
export const invalidPartMotionsReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "partMotions must be an object keyed by Part";
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "partMotions must name at least one Part — omit it to leave every Part as its Asset runs it";
  for (const [part, motion] of entries) {
    if (part.length === 0) return "partMotions must not have an empty Part name";
    const reason = invalidMotionReason(motion);
    if (reason) return `partMotions.${part}: ${reason}`;
  }
  return undefined;
};

/**
 * The first Segment whose {@link PartMotions} addresses a Part its Asset has
 * no moving one of, or `undefined` (ADR 0124). A Revision is immutable (ADR
 * 0032): a retune addressed to an arm that does not exist would be ignored
 * forever, so publish refuses it.
 */
export const invalidPartMotionsTargetReason = (track: Track, modules: Record<string, Module>): string | undefined => {
  for (const [index, segment] of track.entries()) {
    if (segment.partMotions === undefined) continue;
    const module = modules[segment.moduleId];
    if (!module) continue;
    const moving = motionPartNames(module);
    for (const part of Object.keys(segment.partMotions)) {
      if (moving.includes(part)) continue;
      const known = moving.length > 0 ? `its moving Parts are ${moving.join(", ")}` : "it has no moving Parts";
      return `track[${index}].partMotions.${part} names no moving Part of "${segment.moduleId}" — ${known}`;
    }
  }
  return undefined;
};
