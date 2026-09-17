import { vec3, type Vec3 } from "../math/vec3.js";

/**
 * What a Player is asking their Character to do this tick. The client resolves
 * raw keys into a camera-relative {@link moveDirection} before handing it in, so
 * the simulation never needs to know about the camera (ADR 0009).
 *
 * Button fields are the *held* state, not edges — the simulation derives presses
 * itself, which keeps this a plain snapshot the netcode can replay (ADR 0003).
 */
export interface SimInputs {
  /** Unit vector on the XZ plane, or zero. Camera-relative, already normalised. */
  moveDirection: Vec3;
  /** Whether the jump button is held this tick. */
  jumpHeld: boolean;
  /** Whether the dash button is held this tick. */
  dashHeld: boolean;
  /** Whether the Hit button is held this tick (M6 ticket 03). */
  hitHeld: boolean;
  /** Whether the Grab button is held this tick (M6 ticket 04). */
  grabHeld: boolean;
  /**
   * Which way this Character's body is turned, world-space yaw in radians
   * (M6, ADR 0045; the body rather than the camera since ADR 0085). Yaw 0
   * looks down −Z. The owning client turns the body toward where it runs and
   * sends where it has got to every tick, so it lags a change of direction
   * and holds still while standing. The simulation only ever sees the plain
   * angle (ADR 0009). Hit and Grab aim along it.
   */
  facing: number;
}

/** "The Player is not doing anything this tick." */
export const IDLE_INPUTS: SimInputs = {
  moveDirection: vec3(),
  jumpHeld: false,
  dashHeld: false,
  hitHeld: false,
  grabHeld: false,
  facing: 0,
};
