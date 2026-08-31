import type { Box } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";

/**
 * A Checkpoint: a trigger volume the Character walks through to set its respawn
 * point, plus where the Respawn puts it (CONTEXT.md).
 */
export interface Checkpoint {
  /** Where the Character reappears after a Fall (capsule centre). */
  respawn: Vec3;
  /** The volume the Character's capsule centre must enter to activate this Checkpoint. */
  volume: Box;
}
