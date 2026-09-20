import { type BoneSnapshot, type BoneSpec, RAGDOLL_BONES } from "@dont-fall/shared";
import * as THREE from "three";
import { boneOf } from "./characterModel.js";

/**
 * Draws a Character's rig straight from its ragdoll's bones — a knockout with
 * no animation in it at all.
 *
 * The game does not do this: ADR 0076 made a knockdown *authored*, posed from
 * clips the ragdoll's own measurements shaped. That reads well head-on and
 * badly from the side, where the authored fall leaves the bean springing on
 * two limbs (the user, 2026-09-20). This is the other option, side by side
 * with it in `rubber.html` so the two can be compared before anything is
 * decided.
 *
 * Only rotations are taken from physics, plus the pelvis's position for the
 * body as a whole. Writing each bone's world position too would let the rig
 * come apart, because nothing constrains the ragdoll's capsules to the rig's
 * own bone lengths; driving rotations keeps the bean in one piece and costs
 * nothing that can be seen.
 */

/**
 * Which rig node each `RAGDOLL_BONES` entry poses. Left and right are
 * deliberately **not** in here: BLIP names its limbs from its own point of
 * view (ADR 0071), so a name-to-name map is a coin flip on whether the body
 * comes out mirrored. {@link RagdollRig} measures which side each one is on
 * instead, the way `floatPose.ts` already does.
 */
const RIG_NODE: Readonly<Record<string, string>> = {
  pelvis: "pelvis",
  chest: "body",
  head: "head",
  upperArm: "upper_arm",
  lowerArm: "forearm",
  upperLeg: "thigh",
  lowerLeg: "shin",
};

/** `upperArmL` → `{ stem: "upperArm", side: "L" }`; a bone with no side answers null. */
const splitSide = (name: string): { stem: string; side: "L" | "R" } | null => {
  const side = name.endsWith("L") ? "L" : name.endsWith("R") ? "R" : null;
  return side ? { stem: name.slice(0, -1), side } : null;
};

interface Driven {
  node: THREE.Object3D;
  /** The node's rotation in the model's own space at rest — what a ragdoll rotation of identity must reproduce. */
  rest: THREE.Quaternion;
}

export class RagdollRig {
  private readonly driven: (Driven | null)[] = [];
  private readonly desired = new THREE.Quaternion();
  private readonly parentWorld = new THREE.Quaternion();
  private readonly snapshotRotation = new THREE.Quaternion();
  private readonly restTurn = new THREE.Quaternion();

  constructor(
    private readonly model: THREE.Object3D,
    /** The group the model hangs in — moved so the rig's pelvis sits where the ragdoll's does. */
    private readonly carrier: THREE.Object3D,
    /**
     * The skeleton being posed. Not always {@link RAGDOLL_BONES}: the demo
     * poses from a differently-shaped one, whose pelvis sits elsewhere — and
     * reading the offset off the wrong table drops the whole body by the
     * difference.
     */
    private readonly bones: readonly BoneSpec[] = RAGDOLL_BONES,
  ) {
    model.updateMatrixWorld(true);

    // Which rig limb is on which side, measured once from where it hangs.
    const sideOf = new Map<string, THREE.Object3D>();
    const toModel = model.matrixWorld.clone().invert();
    for (const stem of ["upper_arm", "forearm", "thigh", "shin"]) {
      const candidates = (["L", "R"] as const)
        .map((s) => boneOf(model, `${stem}.${s}`))
        .filter((b): b is THREE.Object3D => b !== undefined);
      for (const bone of candidates) {
        const x = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel).x;
        // `RAGDOLL_BONES` puts its own `L` bones at positive x.
        sideOf.set(`${stem}:${x >= 0 ? "L" : "R"}`, bone);
      }
    }

    for (const spec of this.bones) {
      const split = splitSide(spec.name);
      // A skeleton may already be named after the rig (an authored one is),
      // in which case there is nothing to translate.
      const direct = boneOf(model, spec.name);
      const stem = RIG_NODE[split ? split.stem : spec.name];
      const node =
        direct ??
        (stem === undefined ? undefined : split ? sideOf.get(`${stem}:${split.side}`) : boneOf(model, stem));
      this.driven.push(node ? { node, rest: node.getWorldQuaternion(new THREE.Quaternion()) } : null);
    }
  }

  /** Every ragdoll bone found a rig node to pose — false means a rig this cannot draw. */
  get complete(): boolean {
    return this.driven.every((d) => d !== null);
  }

  /**
   * Writes one frame of the ragdoll onto the rig. `bones` is in the posed
   * skeleton's own order, as `Ragdoll.readBones` returns it.
   *
   * Parent before child, which `RAGDOLL_BONES`' own order already gives:
   * each bone's local rotation is solved against a parent that has already
   * been placed this frame.
   */
  pose(bones: readonly BoneSnapshot[]): void {
    const pelvis = bones[0];
    if (!pelvis) return;
    // The rig's pelvis sits at a fixed offset below the carrier, so moving the
    // carrier is what puts the body where the physics put it.
    const rest = this.bones[0]!.restCenter;
    this.carrier.position.set(pelvis.position.x - rest.x, pelvis.position.y - rest.y, pelvis.position.z - rest.z);

    for (const [i, driven] of this.driven.entries()) {
      const snapshot = bones[i];
      if (!driven || !snapshot || !driven.node.parent) continue;
      const { x, y, z, w } = snapshot.rotation;
      // How far the bone has turned *since its rest pose*, which is identity
      // for the game's skeleton and not for one whose arms start out sideways.
      const rest = this.bones[i]?.restRotation;
      this.snapshotRotation.set(x, y, z, w);
      if (rest) this.snapshotRotation.multiply(this.restTurn.set(rest.x, rest.y, rest.z, rest.w).invert());
      this.desired.copy(this.snapshotRotation).multiply(driven.rest);
      driven.node.parent.getWorldQuaternion(this.parentWorld);
      driven.node.quaternion.copy(this.parentWorld.invert().multiply(this.desired));
      driven.node.updateMatrixWorld(true);
    }
  }

  /** Puts the carrier back where it was, for handing the rig back to the mixer. */
  release(carrierPosition: THREE.Vector3): void {
    this.carrier.position.copy(carrierPosition);
    this.model.updateMatrixWorld(true);
  }
}
