import { clampPitch } from "./springArm.js";

/** Radians of camera rotation per pixel of raw mouse movement. */
export const LOOK_SENSITIVITY = 0.0022;

export interface Look {
  /** Rotation about Y, unbounded. */
  yaw: number;
  /** Rotation about the local X axis, clamped to the camera's pitch range. */
  pitch: number;
}

/**
 * Apply one mouse-move delta to a look orientation. Moving the mouse right turns
 * the view right (yaw decreases); moving it down looks down. Yaw wraps freely;
 * pitch is clamped so the camera never flips over.
 */
export const applyLook = (current: Look, movementX: number, movementY: number): Look => ({
  yaw: current.yaw - movementX * LOOK_SENSITIVITY,
  pitch: clampPitch(current.pitch + movementY * LOOK_SENSITIVITY),
});
