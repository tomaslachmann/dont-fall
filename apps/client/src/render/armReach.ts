import * as THREE from "three";

/**
 * Shoulder → upper-arm → lower-arm node-name triples this pose drives — the
 * same rig nodes `ragdollPose.ts` already maps. No `.` (`UpperArmL`, not
 * `UpperArm.L`): the source .gltf's own `nodes[].name` field does carry a
 * dot, but `GLTFLoader` strips it when building the scene graph — confirmed
 * by loading the real model directly and printing every node name, after
 * these dotted names left this file silently matching nothing (found live:
 * Grab visibly did nothing at all).
 */
const ARM_TRIPLES = [
  { shoulder: "ShoulderL", upperArm: "UpperArmL", lowerArm: "LowerArmL" },
  { shoulder: "ShoulderR", upperArm: "UpperArmR", lowerArm: "LowerArmR" },
] as const;

export interface ArmReachNodes {
  shoulder: THREE.Object3D;
  upperArm: THREE.Object3D;
  /** The forearm, if present — blended toward {@link lowerArmBindQuaternion} while reaching rather than left to the mixer (see `ArmReachPlayer`). */
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

/**
 * How fast the reach blends in/out (1/s, exponential approach) — live
 * feedback: an instant snap on either end read as broken, not held. Reaches
 * ~95% of the way in about half a second.
 */
const REACH_BLEND_RATE = 6;

const UP = new THREE.Vector3(0, 1, 0);
const shoulderPos = new THREE.Vector3();
const parentQuat = new THREE.Quaternion();
const localTarget = new THREE.Vector3();
const naturalQuat = new THREE.Quaternion();

export interface ArmReachPlayer {
  /**
   * Advance the reach blend by one frame and apply it. `targetWorldPosition`
   * is this Character's own held target's world position (already offset to
   * reach height by the caller), or `undefined` while not grabbing anyone.
   * Safe — and necessary — to call every frame regardless of grab state: it
   * eases the arms in when a target first appears and back out to the
   * mixer's own natural pose once it goes away, rather than the pose
   * popping on either end (found live: "the arms just appear with no
   * transition").
   */
  update(targetWorldPosition: THREE.Vector3 | undefined, deltaSeconds: number): void;
}

/**
 * Drives Grab's arm-reach pose for one rig, blended in and out (M6.1). A
 * procedural pose, not a canned clip (the rig has none) — see
 * {@link findArmReachNodes}'s own doc comment for the aiming math and the
 * rig's bind-orientation subtlety.
 *
 * The blend is a single scalar `weight` (0 = pure mixer pose, 1 = pure
 * reach), eased toward 1 while a target is given and back to 0 once it
 * isn't, applied per arm as `slerp(thisFrame'sNaturalPose, reachPose,
 * weight)` — reading the natural pose fresh every frame (whatever the
 * mixer's walk/idle clip just set) rather than a pose captured once, so the
 * blend still tracks a Character that's walking/idling while easing in or
 * out. While fading out with no live target, the last computed reach
 * quaternion is held frozen (nothing to recompute it toward) and blended
 * away from — never a stale direction snapped back to on the next grab.
 */
export const createArmReachPlayer = (root: THREE.Object3D): ArmReachPlayer => {
  const nodes = findArmReachNodes(root);
  const reachQuats = nodes.map(() => new THREE.Quaternion());
  let weight = 0;

  return {
    update(targetWorldPosition, deltaSeconds) {
      if (nodes.length === 0) return;

      const targetWeight = targetWorldPosition ? 1 : 0;
      const ease = 1 - Math.exp(-REACH_BLEND_RATE * Math.max(0, deltaSeconds));
      weight += (targetWeight - weight) * ease;
      if (weight < 1e-3) return; // fully released — leave the mixer's own pose alone

      if (targetWorldPosition) root.updateMatrixWorld(true);

      nodes.forEach(({ shoulder, upperArm, lowerArm, lowerArmBindQuaternion }, i) => {
        if (targetWorldPosition) {
          shoulder.getWorldPosition(shoulderPos);
          localTarget.copy(targetWorldPosition).sub(shoulderPos);
          if (localTarget.lengthSq() >= 1e-6) {
            localTarget.normalize();
            shoulder.getWorldQuaternion(parentQuat).invert();
            localTarget.applyQuaternion(parentQuat);
            reachQuats[i]!.setFromUnitVectors(UP, localTarget);
          }
        }
        naturalQuat.copy(upperArm.quaternion);
        upperArm.quaternion.copy(naturalQuat).slerp(reachQuats[i]!, weight);

        if (lowerArm && lowerArmBindQuaternion) {
          naturalQuat.copy(lowerArm.quaternion);
          lowerArm.quaternion.copy(naturalQuat).slerp(lowerArmBindQuaternion, weight);
        }
      });
    },
  };
};
