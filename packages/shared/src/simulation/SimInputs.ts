import { vec3, type Vec3 } from "../math/vec3.js";

/**
 * What a Player is asking their Character to do this tick. The client resolves
 * raw keys into a camera-relative {@link moveDirection} before handing it in, so
 * the simulation never needs to know about the camera (ADR 0009).
 */
export interface SimInputs {
  /** Unit vector on the XZ plane, or zero. Camera-relative, already normalised. */
  moveDirection: Vec3;
}

/** "The Player is not doing anything this tick." */
export const IDLE_INPUTS: SimInputs = { moveDirection: vec3() };
