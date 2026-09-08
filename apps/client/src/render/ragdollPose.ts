import * as THREE from "three";
import { RAGDOLL_BONES, type BoneSnapshot } from "@dont-fall/shared";

/**
 * Which rig node each ragdoll bone drives (M6.1 ticket 02, ADR 0048). The
 * MushroomKing rig has 43 joints and the ragdoll has 11, so the mapping is
 * deliberately partial: everything unlisted (`Abdomen`, `Neck`, `Shoulder*`,
 * the fingers, `Foot*`, the IK poles) keeps its bind pose and comes along
 * inside whichever mapped parent it hangs from.
 *
 * Node names here have no `.` (`UpperArmL`, not `UpperArm.L`) even though the
 * source .gltf's own `nodes[].name` field does use a dot — code review, M6.1
 * ticket 05: `GLTFLoader` strips it from bone names when constructing the
 * scene graph (almost certainly because `AnimationClip`/`PropertyBinding`
 * track paths are themselves dot-separated `nodeName.property` strings, so a
 * dot inside the node name itself would be ambiguous). Confirmed against the
 * actual loaded model, not just the raw file, after this exact mismatch left
 * `armReach.ts` silently matching nothing.
 */
const BONE_TO_NODE: Readonly<Record<string, string>> = {
  pelvis: "Body",
  chest: "Torso",
  head: "Head",
  upperArmL: "UpperArmL",
  lowerArmL: "LowerArmL",
  upperArmR: "UpperArmR",
  lowerArmR: "LowerArmR",
  upperLegL: "UpperLegL",
  lowerLegL: "LowerLegL",
  upperLegR: "UpperLegR",
  lowerLegR: "LowerLegR",
};

/** `RAGDOLL_BONES` order is parents-first, which is what makes a single pass enough. */
const DRIVEN = RAGDOLL_BONES.map((spec, index) => ({ index, node: BONE_TO_NODE[spec.name] })).filter(
  (entry): entry is { index: number; node: string } => entry.node !== undefined,
);

const PELVIS_INDEX = RAGDOLL_BONES.findIndex((b) => b.name === "pelvis");

export interface RagdollPose {
  /**
   * Pose the rig from one snapshot's worth of ragdoll bones. Safe to call
   * every frame while a Character is down, and a no-op if `bones` isn't a
   * full skeleton (the snapshot carries an empty array whenever it isn't).
   */
  apply(bones: readonly BoneSnapshot[]): void;
  /** The Character is back on its feet: forget the anchor so the next knockdown takes a fresh one. */
  release(): void;
  /** Whether a knockdown is currently being posed — the caller uses this to keep locomotion out of the way. */
  readonly isPosing: boolean;
}

/**
 * Drives a character rig from the physics ragdoll's own bones instead of a
 * canned clip (M6.1 ticket 02, ADR 0048).
 *
 * **Rotations only.** The ragdoll's proportions are not the rig's — its arm
 * span and leg length are a generic humanoid's, the rig is a mushroom — so
 * writing bone world *positions* stretches the mesh between them. Orientation
 * comes from physics, the rig keeps its own bone lengths, and the whole thing
 * is then slid so its pelvis sits where the simulation's pelvis actually is.
 *
 * **The anchor is taken on the first frame of a knockdown, not at load.** A
 * ragdoll body's rest orientation is upright and unrotated; the rig's arms
 * hang down and out. Composing the physics rotation onto the *bind* pose
 * assumes those agree — they do not, and assuming it folds every limb into
 * the torso. Anchoring instead against whatever pose the rig is in when the
 * knockdown starts also means the fall begins from the pose the Character was
 * actually in, with no pop.
 *
 * `placed` is both the object whose `position` is written and the object the
 * bones are looked up inside — the local Character's placement group, or one
 * remote rig's root.
 */
export const createRagdollPose = (placed: THREE.Object3D): RagdollPose => {
  const nodes = new Map<string, THREE.Object3D>();
  for (const { node } of DRIVEN) {
    const found = placed.getObjectByName(node);
    if (found) nodes.set(node, found);
  }

  /** Per-node rotation from the physics bone's frame into the rig's, taken once per knockdown. */
  let anchor: Map<string, THREE.Quaternion> | null = null;

  const parentWorld = new THREE.Quaternion();
  const desired = new THREE.Quaternion();
  const pelvisWorld = new THREE.Vector3();

  return {
    get isPosing() {
      return anchor !== null;
    },
    release() {
      anchor = null;
    },
    apply(bones) {
      if (bones.length !== RAGDOLL_BONES.length) return;
      placed.updateMatrixWorld(true);

      if (anchor === null) {
        anchor = new Map();
        for (const { index, node } of DRIVEN) {
          const bone = nodes.get(node);
          if (!bone) continue;
          const { rotation } = bones[index]!;
          // A fresh quaternion per entry: `invert`/`multiply` mutate in place,
          // so a shared scratch one would leave every node pointing at the
          // same object holding the last node's value.
          const offset = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
            .invert()
            .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
          anchor.set(node, offset);
        }
      }

      for (const { index, node } of DRIVEN) {
        const bone = nodes.get(node);
        const offset = anchor.get(node);
        if (!bone || !offset || !bone.parent) continue;
        const { rotation } = bones[index]!;
        desired.set(rotation.x, rotation.y, rotation.z, rotation.w).multiply(offset);
        // local = inverse(parent world) * desired world. Parents are handled
        // first, and updating each bone's subtree as we go keeps the unmapped
        // nodes between them (Abdomen, Neck, Shoulder…) current.
        bone.parent.getWorldQuaternion(parentWorld);
        bone.quaternion.copy(parentWorld.invert().multiply(desired));
        bone.updateMatrixWorld(true);
      }

      // Slide the whole rig so its pelvis lands on the simulation's.
      const pelvisNode = nodes.get(BONE_TO_NODE["pelvis"]!);
      if (!pelvisNode) return;
      placed.updateMatrixWorld(true);
      pelvisNode.getWorldPosition(pelvisWorld);
      const want = bones[PELVIS_INDEX]!.position;
      placed.position.add(new THREE.Vector3(want.x - pelvisWorld.x, want.y - pelvisWorld.y, want.z - pelvisWorld.z));
    },
  };
};
