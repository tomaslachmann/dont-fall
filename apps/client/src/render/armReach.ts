import * as THREE from "three";

/** Shoulder → upper-arm → lower-arm node-name triples this pose drives — the same rig nodes `ragdollPose.ts` already maps. */
const ARM_TRIPLES = [
  { shoulder: "Shoulder.L", upperArm: "UpperArm.L", lowerArm: "LowerArm.L" },
  { shoulder: "Shoulder.R", upperArm: "UpperArm.R", lowerArm: "LowerArm.R" },
] as const;

export interface ArmReachNodes {
  shoulder: THREE.Object3D;
  upperArm: THREE.Object3D;
  /** The forearm, if present — frozen at {@link lowerArmBindQuaternion} while reaching rather than left to the mixer (see `applyArmReach`). */
  lowerArm?: THREE.Object3D;
  /** `lowerArm`'s own bind-pose local rotation, captured once at lookup time — before any clip has ever played, so this is the model's true rest bend, not whatever the mixer happened to leave it at. */
  lowerArmBindQuaternion?: THREE.Quaternion;
}

/**
 * Looks up the arm nodes once per rig (M6.1) — a side missing its shoulder or
 * upper arm is dropped rather than throwing, so a rig short a bone (should
 * never happen on MushroomKing, but cheaper than crashing) just reaches with
 * whichever arm it still has. A missing lower arm is tolerated on its own —
 * that side simply reaches with a straight arm instead of a bent one.
 *
 * Must be called before the rig's `AnimationMixer` ever runs a clip (right
 * after the model loads/clones, same timing `buildRig`/`createStage` already
 * use for their own one-time setup) — the lower arm's bind quaternion is
 * captured here, and is only the model's true rest pose while nothing has
 * animated it yet.
 */
export const findArmReachNodes = (root: THREE.Object3D): ArmReachNodes[] => {
  const result: ArmReachNodes[] = [];
  for (const { shoulder, upperArm, lowerArm } of ARM_TRIPLES) {
    const shoulderNode = root.getObjectByName(shoulder);
    const upperArmNode = root.getObjectByName(upperArm);
    if (!shoulderNode || !upperArmNode) continue;
    const lowerArmNode = root.getObjectByName(lowerArm);
    result.push({
      shoulder: shoulderNode,
      upperArm: upperArmNode,
      ...(lowerArmNode ? { lowerArm: lowerArmNode, lowerArmBindQuaternion: lowerArmNode.quaternion.clone() } : {}),
    });
  }
  return result;
};

/** How far above the held Character's own root position the reach aims — chest height, not feet (M6.1). */
export const ARM_REACH_TARGET_HEIGHT = 0.8;

const UP = new THREE.Vector3(0, 1, 0);
const shoulderPos = new THREE.Vector3();
const parentQuat = new THREE.Quaternion();
const localTarget = new THREE.Vector3();
const desired = new THREE.Quaternion();

/**
 * Rotates the upper arm bones to reach toward `targetWorldPosition` (M6.1,
 * Grab) — a procedural pose, not a canned clip (the rig has none). An
 * additive OVERRIDE applied after the mixer each frame, written the same way
 * `ragdollPose.ts` writes bone quaternions directly, not a blended animation
 * layer.
 *
 * Aims each upper arm's own bone axis — local +Y, the direction toward its
 * child, the same convention `ragdollPose.ts` relies on — at the target,
 * computed in each shoulder's own *local* frame so the result is a valid
 * local rotation regardless of the rig's own bind orientation (MushroomKing's
 * shoulder/upper-arm bind rotations are far from identity — see that file's
 * own doc comment on why a naive Euler set here would twist the limb).
 *
 * The lower arm, if present, is reset to its own bind-pose rotation every
 * frame this runs — without this it keeps playing whatever the walk/idle
 * clip already had it doing, flailing independently of the now-pinned upper
 * arm above it (a visibly dislocated elbow). Freezing it at the *bind*
 * rotation rather than a fixed world pose is deliberate: that rotation is
 * defined relative to the upper arm's own frame, so it reads as the model's
 * natural resting elbow bend wherever the upper arm now actually points,
 * not a fixed pose that only looked right in the bind orientation.
 *
 * Calls `updateMatrixWorld` on `root` itself, so the shoulders' current
 * (mixer-driven) world transforms are read fresh for this frame, not
 * whatever they were on the last render.
 */
export const applyArmReach = (root: THREE.Object3D, nodes: readonly ArmReachNodes[], targetWorldPosition: THREE.Vector3): void => {
  if (nodes.length === 0) return;
  root.updateMatrixWorld(true);

  for (const { shoulder, upperArm, lowerArm, lowerArmBindQuaternion } of nodes) {
    shoulder.getWorldPosition(shoulderPos);
    localTarget.copy(targetWorldPosition).sub(shoulderPos);
    if (localTarget.lengthSq() < 1e-6) continue; // degenerate — shoulder sits exactly at the target
    localTarget.normalize();
    shoulder.getWorldQuaternion(parentQuat).invert();
    localTarget.applyQuaternion(parentQuat);
    desired.setFromUnitVectors(UP, localTarget);
    upperArm.quaternion.copy(desired);
    if (lowerArm && lowerArmBindQuaternion) lowerArm.quaternion.copy(lowerArmBindQuaternion);
  }
};
