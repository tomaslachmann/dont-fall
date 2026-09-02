import type { Box } from "../math/box.js";
import { addVec3, type Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";
import { MODULE_STEP, type Module } from "./Module.js";

/**
 * One placed instance of a Module in a Track (CONTEXT.md: Segment). `rotation`
 * is reserved for a future branching/turning Track — M3 Tracks are strictly
 * linear (ADR 0030), so every Segment's `rotation` is `0`.
 */
export interface Segment {
  moduleId: string;
  position: Vec3;
  rotation: number;
}

/** A Track: an ordered sequence of Segments (CONTEXT.md). */
export type Track = Segment[];

/**
 * Places `moduleIds` end-to-end from `start`, each one `MODULE_STEP` after the
 * last. This is the "no compatibility metadata" chaining ADR 0030's uniform
 * footprint exists to enable — a hand-built Track from a builder can still
 * override individual Segment positions afterward; a randomly-assembled one
 * can use this as-is.
 */
export const chainTrack = (moduleIds: string[], start: Vec3 = { x: 0, y: 0, z: 0 }): Track => {
  let position = start;
  const track: Track = [];
  for (const moduleId of moduleIds) {
    track.push({ moduleId, position, rotation: 0 });
    position = addVec3(position, MODULE_STEP);
  }
  return track;
};

/** Flattens a Track into the world-space geometry `RapierSimulation`/the scene consume. */
export const resolveTrack = (
  modules: Record<string, Module>,
  track: Track,
): { statics: Box[]; props: PropConfig[]; spinners: SpinnerConfig[]; checkpoints: Checkpoint[] } => {
  const statics: Box[] = [];
  const props: PropConfig[] = [];
  const spinners: SpinnerConfig[] = [];
  const checkpoints: Checkpoint[] = [];

  for (const segment of track) {
    const module = modules[segment.moduleId];
    if (!module) throw new Error(`Track references unknown Module "${segment.moduleId}"`);

    for (const box of module.statics) {
      statics.push({ center: addVec3(box.center, segment.position), halfExtents: box.halfExtents });
    }
    for (const prop of module.props ?? []) {
      props.push({ ...prop, center: addVec3(prop.center, segment.position) });
    }
    for (const spinner of module.spinners ?? []) {
      spinners.push({ ...spinner, center: addVec3(spinner.center, segment.position) });
    }
    if (module.checkpoint) {
      checkpoints.push({
        respawn: addVec3(module.checkpoint.respawn, segment.position),
        volume: {
          center: addVec3(module.checkpoint.volume.center, segment.position),
          halfExtents: module.checkpoint.volume.halfExtents,
        },
      });
    }
  }

  return { statics, props, spinners, checkpoints };
};
