import { BLIP_RAGDOLL_SPEC, type BoneSnapshot } from "@dont-fall/shared";
import * as THREE from "three";
import { boneOf } from "./characterModel.js";

/**
 * Draws a Character's rig straight from its ragdoll's bones — a knockdown
 * with no animation in it at all (`.scratch/physical-ragdoll` ticket 02,
 * superseding ADR 0076's authored `KO_X` fall; the get-up clip stays).
 *
 * The authored rig puts a body on each of BLIP's own bone pivots, so a bone's
 * body transform *is* where that bone goes: position and rotation both, with
 * no bind offset to undo and nothing to stretch. Each bone's local transform
 * is solved against its parent's real `matrixWorld`, parent before child —
 * the real matrix because it carries the model's uniform scale, so inverting
 * it hands back an offset already divided by that scale, which composing
 * through the parent restores. (The rubber bench measured the alternative:
 * solving against a unit-scale matrix drew every bone at 58% of its offset
 * and squashed the torso into the pelvis.) The scale the decompose reports is
 * discarded on purpose: a ragdoll owns where a bone is and which way it
 * faces, never how big it is.
 */

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

export class RagdollRig {
  private readonly bones: (THREE.Object3D | null)[] = [];
  private readonly target = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();

  constructor(
    private readonly model: THREE.Object3D,
    /** The group the model hangs in — the caller places it; the bones land in world space regardless. */
    private readonly carrier: THREE.Object3D,
    /** The skeleton being posed, wire order (parent before child). */
    private readonly names: readonly string[] = BLIP_RAGDOLL_SPEC.bones.map((b) => b.bone),
  ) {
    model.updateMatrixWorld(true);
    // `boneOf` handles GLTFLoader's dot-stripping (`upper_arm.L` →
    // `upper_armL`); the spec keeps the dots the source file writes.
    for (const name of this.names) this.bones.push(boneOf(model, name) ?? null);
  }

  /** Every ragdoll bone found its rig node — false means a rig this cannot draw. */
  get complete(): boolean {
    return this.bones.every((bone) => bone !== null);
  }

  /**
   * Writes one frame of the ragdoll onto the rig, in world space. `bones` is
   * the replicated snapshot, in the spec's own order.
   *
   * The bones physics does not drive — the GLB's `root`, the crest, the eyes
   * — still hold whatever clip played before the knockdown. The driven bones
   * are compensated against them, so the world pose is right either way; but
   * a heap written over a stale root is a heap the get-up then blends out of
   * through that root. {@link restUndriven} is what the caller resets first.
   */
  pose(bones: readonly BoneSnapshot[]): void {
    // Ancestors physics does not drive must be where the renderer last put
    // them before locals solve against them.
    this.carrier.updateMatrixWorld(true);
    for (const [i, bone] of this.bones.entries()) {
      const snapshot = bones[i];
      if (!bone?.parent || !snapshot) continue;
      const { position: p, rotation: r } = snapshot;
      this.target.compose(this.position.set(p.x, p.y, p.z), this.rotation.set(r.x, r.y, r.z, r.w), UNIT_SCALE);
      this.local.copy(bone.parent.matrixWorld).invert().multiply(this.target);
      this.local.decompose(this.position, this.rotation, this.scratchScale);
      bone.position.copy(this.position);
      bone.quaternion.copy(this.rotation);
      bone.updateMatrix();
      bone.updateMatrixWorld(true);
    }
  }

  /** Puts every bone back in its bind pose — run once when a knockdown starts. */
  restUndriven(): void {
    this.model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) mesh.skeleton.pose();
    });
  }

  /** Puts the carrier back where it was, for handing the rig back to the mixer. */
  release(carrierPosition: THREE.Vector3): void {
    this.carrier.position.copy(carrierPosition);
    this.model.updateMatrixWorld(true);
  }
}
