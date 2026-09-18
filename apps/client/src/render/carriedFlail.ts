import { GRAB_CARRY_DISTANCE, GRAVITY_Y, forwardOf, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * How a carried body hangs and streams in its grabber's hands (ADR 0104's
 * drawn hold) — render-only: the simulation still carries the capsule rigidly
 * at the carry point, so swing Impacts and a Hurl's launch are untouched.
 *
 * Two things happen to the drawn body, both derived from state every client
 * already has (the held Character's own replicated `facing` and `velocity` —
 * no grabber lookup, no protocol change):
 *
 * 1. **It sits in the hands.** The rig's arms-out hold (`Grab_HoldOut`) grips
 *    at 0.68 units ahead and 1.54 up (measured on the rig at game scale),
 *    while the sim's carry point centres the body at 1.1 ahead and 1.25 up —
 *    half a metre of air between the fingertips and the body. The drawn body
 *    is pulled toward its grabber (along its own facing, which IS toward the
 *    grabber while Held) and dropped a little, so its upper back rests where
 *    the hands are.
 * 2. **It hangs like a swung mass.** The body pivots at the grip: its feet
 *    settle along *apparent* gravity — real gravity, plus the centrifugal
 *    push of however fast the body is being carried (a full Spin whirls the
 *    carry point at ~10.4 u/s), plus a drag term that trails the feet behind
 *    the direction of travel. Standing still it hangs straight down; whirled,
 *    it streams out almost flat, feet away from the grabber, trailing the
 *    turn — while the head stays in the hands.
 *
 * The hang direction is eased, not snapped, so the stream builds and settles
 * like a real pendulum instead of popping with each speed change.
 */

/** How much closer to the grabber the drawn body sits than the sim's carry point (units). */
export const CARRY_DRAWN_PULL = 0.12;
/** How much lower the drawn body sits than the sim's carry point (units). */
export const CARRY_DRAWN_DROP = 0.18;
/**
 * The grip above the drawn body's capsule centre (units): where the hands
 * hold it, and the pivot the body hangs from. Hands at 1.54 over the
 * grabber's feet, drawn centre at 1.25 − {@link CARRY_DRAWN_DROP} ≈ 1.07.
 */
export const CARRY_GRIP_ABOVE_CENTRE = 0.47;
/**
 * The steepest the body may stream out from vertical (rad). Physically a full
 * Spin's apparent gravity would lay it at 77°; capped a touch under so the
 * head never quite dips below the hands.
 */
export const CARRY_MAX_STREAM = (65 * Math.PI) / 180;
/** Drag coefficient trailing the feet behind the direction of travel (per u/s of carry speed). */
export const CARRY_TRAIL_DRAG = 0.6;
/** How quickly the hang direction follows its target (1/s) — a pendulum settling, not a snap. */
export const CARRY_HANG_RESPONSE = 8;

/** The damped hang of one carried body — keep one per held Character, and drop it when the hold ends. */
export interface CarriedHang {
  hang: THREE.Vector3;
}

/** A body at rest hangs straight down. */
export const restCarriedHang = (): CarriedHang => ({ hang: new THREE.Vector3(0, -1, 0) });

/** What the drawn hold needs to know about the carried body this frame — all replicated. */
export interface CarriedBody {
  /** The drawn capsule centre (after interpolation, and `carriedPose` on the grabber's own client). */
  centre: Vec3;
  /** The held Character's `facing` — toward its grabber, the whole hold (ADR 0104). */
  facing: number;
  /** The held Character's replicated velocity — the carry's, tangential Spin speed included. */
  velocity: Vec3;
}

/** Where to put the carried rig this frame: its root (feet) and its full orientation. */
export interface CarriedPlacement {
  feet: THREE.Vector3;
  /** The rig's world orientation: its yaw, tilted so its up runs grip-ward along the hang. */
  quaternion: THREE.Quaternion;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Advance `state`'s hang toward this frame's apparent gravity and place the
 * rig from it. `modelYaw` is the yaw the rig would stand at untilted (the
 * caller's own `modelYawFromFacing` result, offsets included).
 */
export const carriedFlail = (
  state: CarriedHang,
  body: CarriedBody,
  modelYaw: number,
  feetBelowCentre: number,
  deltaSeconds: number,
): CarriedPlacement => {
  // Apparent gravity at the grip: down, plus the centrifugal push away from
  // the grabber (v²/r along −facing), plus drag trailing the feet behind the
  // direction of travel. |GRAVITY_Y| is the game's own 22, not Earth's.
  const toGrabber = forwardOf(body.facing);
  const speed = Math.hypot(body.velocity.x, body.velocity.z);
  const centrifugal = (speed * speed) / GRAB_CARRY_DISTANCE;
  const target = new THREE.Vector3(-toGrabber.x * centrifugal, GRAVITY_Y, -toGrabber.z * centrifugal);
  if (speed > 1e-6) {
    const drag = CARRY_TRAIL_DRAG * speed;
    target.x -= (body.velocity.x / speed) * drag;
    target.z -= (body.velocity.z / speed) * drag;
  }
  target.normalize();
  // Cap how flat it may stream: swing straight-down toward the target by
  // exactly the cap (a lerp would overshoot the angle — chord, not arc).
  const down = new THREE.Vector3(0, -1, 0);
  const fromDown = target.angleTo(down);
  if (fromDown > CARRY_MAX_STREAM) {
    const axis = new THREE.Vector3().crossVectors(down, target).normalize();
    target.copy(down.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, CARRY_MAX_STREAM)));
  }

  const follow = 1 - Math.exp(-CARRY_HANG_RESPONSE * Math.max(0, deltaSeconds));
  state.hang.lerp(target, follow).normalize();

  // The grip stays put; centre and feet hang from it along the eased hang.
  const grip = new THREE.Vector3(
    body.centre.x + toGrabber.x * CARRY_DRAWN_PULL,
    body.centre.y - CARRY_DRAWN_DROP + CARRY_GRIP_ABOVE_CENTRE,
    body.centre.z + toGrabber.z * CARRY_DRAWN_PULL,
  );
  const centre = grip.clone().addScaledVector(state.hang, CARRY_GRIP_ABOVE_CENTRE);
  const feet = centre.addScaledVector(state.hang, feetBelowCentre);
  const tilt = new THREE.Quaternion().setFromUnitVectors(UP, state.hang.clone().negate());
  const yaw = new THREE.Quaternion().setFromAxisAngle(UP, modelYaw);
  return { feet, quaternion: tilt.multiply(yaw) };
};
