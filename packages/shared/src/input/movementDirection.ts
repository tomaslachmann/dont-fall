import { normalizeVec3, vec3, type Vec3 } from "../math/vec3.js";

/** Which movement keys are held this tick. Framework- and device-agnostic. */
export interface MovementKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/**
 * The camera-relative direction the Character should move this tick, as a unit
 * vector on the XZ plane (or zero if no net input).
 *
 * `cameraYaw` is the camera's rotation about the Y axis in radians: yaw 0 looks
 * toward north (−Z), matching Three.js's default camera orientation. This
 * function knows nothing about Rapier or Three — it is a pure mapping (ADR 0009).
 */
export const movementDirection = (keys: MovementKeys, cameraYaw: number): Vec3 => {
  const forwardAxis = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const rightAxis = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);

  // forward(yaw) = (sin, 0, -cos); right(yaw) = (cos, 0, sin)
  const raw = vec3(
    forwardAxis * sin + rightAxis * cos,
    0,
    forwardAxis * -cos + rightAxis * sin,
  );

  return normalizeVec3(raw);
};
