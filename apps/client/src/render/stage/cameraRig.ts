import type { Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import {
  armTargetLength,
  CAMERA_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_PROBE_RADIUS,
  CAMERA_SKIN,
  easeArmLength,
  pointOnArm,
  springArmPosition,
  thickCast,
} from "../../input/camera/springArm.js";

/** The Stage's camera on its spring arm (ADR 0086). */
export interface CameraRig {
  /**
   * Place the camera on a collision-resolved spring arm around `target`, the
   * arm's length easing toward what the probe allows over `deltaSeconds`
   * rather than jumping to it.
   */
  follow: (target: Vec3, yaw: number, pitch: number, deltaSeconds: number) => void;
  /** The point the camera last followed — where the shadow box centres (ADR 0074). */
  focus: () => Vec3 | undefined;
}

/** A spring arm for `camera` that stops short of anything in `collidables`. */
export const createCameraRig = (camera: THREE.PerspectiveCamera, collidables: THREE.Object3D[]): CameraRig => {
  const raycaster = new THREE.Raycaster();
  const castArm = (from: Vec3, to: Vec3): number | null => {
    const origin = new THREE.Vector3(from.x, from.y, from.z);
    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const distance = dir.length();
    if (distance === 0) return null;
    raycaster.set(origin, dir.normalize());
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(collidables, false)[0];
    return hit ? hit.distance : null;
  };
  const probeArm = thickCast(castArm, CAMERA_PROBE_RADIUS);
  /** The arm's current length; `null` until the first frame places the camera outright. */
  let armLength: number | null = null;
  let focus: Vec3 | undefined;

  return {
    follow: (target, yaw, pitch, deltaSeconds) => {
      const desired = springArmPosition(target, yaw, pitch, CAMERA_DISTANCE);
      const wanted = armTargetLength(target, desired, probeArm, CAMERA_MIN_DISTANCE, CAMERA_SKIN);
      armLength = armLength === null ? wanted : easeArmLength(armLength, wanted, deltaSeconds);
      const resolved = pointOnArm(target, desired, armLength);
      camera.position.set(resolved.x, resolved.y, resolved.z);
      camera.lookAt(target.x, target.y, target.z);
      focus = target;
    },
    focus: () => focus,
  };
};
