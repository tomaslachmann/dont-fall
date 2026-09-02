import type { Box } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";

/**
 * A reusable Track piece (CONTEXT.md: Module), authored once in local space —
 * geometry/Props/Spinners/Checkpoint are all relative to the Module's own
 * origin, translated into world space wherever a Track places it (a Segment).
 */
export interface Module {
  id: string;
  statics: Box[];
  props?: PropConfig[];
  spinners?: SpinnerConfig[];
  checkpoint?: Checkpoint;
}

/**
 * The uniform displacement from one Segment's origin to the next (ADR 0030):
 * every Module shares this same footprint regardless of its own content, so a
 * Track can chain any Module after any other with no per-Module compatibility
 * metadata. `chainTrack` (`./Track.ts`) is the only thing that reads this.
 */
export const MODULE_STEP: Vec3 = { x: 0, y: -0.5, z: -6 };
