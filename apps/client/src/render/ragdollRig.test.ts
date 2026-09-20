import { BLIP_RAGDOLL_SPEC, type BoneSnapshot } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RagdollRig } from "./ragdollRig.js";

/**
 * A rig shaped like BLIP's: every spec bone as a node, parented the way the
 * skeleton is, under a model that is scaled and offset the way the game
 * scales it (`CHARACTER_VISUAL_HEIGHT / the GLB's own height`). The names are
 * what GLTFLoader leaves behind — `upper_arm.L` arrives as `upper_armL`.
 */
const fakeRig = (scale = 0.58243): { model: THREE.Object3D; carrier: THREE.Object3D } => {
  const carrier = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(scale);
  model.position.y = 0.3;
  carrier.add(model);
  // The GLB's own undriven root, which every bone hangs under.
  const root = new THREE.Object3D();
  root.name = "root";
  model.add(root);

  const nodes = new Map<string, THREE.Object3D>([["root", root]]);
  const parentOf: Record<string, string> = {
    pelvis: "root",
    body: "pelvis",
    head: "body",
    "upper_arm.L": "body",
    "forearm.L": "upper_arm.L",
    "hand.L": "forearm.L",
    "upper_arm.R": "body",
    "forearm.R": "upper_arm.R",
    "hand.R": "forearm.R",
    "thigh.L": "pelvis",
    "shin.L": "thigh.L",
    "foot.L": "shin.L",
    "thigh.R": "pelvis",
    "shin.R": "thigh.R",
    "foot.R": "shin.R",
  };
  for (const spec of BLIP_RAGDOLL_SPEC.bones) {
    const node = new THREE.Object3D();
    node.name = spec.bone.replace(/\./g, "");
    // Somewhere plausible to start from: the rest pose, in the rig's own units.
    node.position.set(spec.rest.position.x / scale, spec.rest.position.y / scale, spec.rest.position.z / scale);
    nodes.get(parentOf[spec.bone]!)!.add(node);
    nodes.set(spec.bone, node);
  }
  return { model, carrier };
};

const quat = (q: { x: number; y: number; z: number; w: number }): THREE.Quaternion =>
  new THREE.Quaternion(q.x, q.y, q.z, q.w);

describe("RagdollRig (.scratch/physical-ragdoll ticket 02)", () => {
  it("finds a rig node for every spec bone, dots and all", () => {
    const { model, carrier } = fakeRig();
    expect(new RagdollRig(model, carrier).complete).toBe(true);
  });

  it("says so when the rig is one it cannot draw", () => {
    const carrier = new THREE.Group();
    const model = new THREE.Group();
    carrier.add(model);
    expect(new RagdollRig(model, carrier).complete).toBe(false);
  });

  /**
   * The whole of it: a bone's body transform *is* where that bone goes,
   * position and rotation both — the authored rig put each body on the rig's
   * own pivot, so there is no bind offset to undo.
   */
  it("lands every bone exactly on its body, in world space", () => {
    const { model, carrier } = fakeRig();
    const rig = new RagdollRig(model, carrier);
    const bones = normalisedHeap();
    rig.pose(bones);
    carrier.updateMatrixWorld(true);
    for (const [i, spec] of BLIP_RAGDOLL_SPEC.bones.entries()) {
      const node = model.getObjectByName(spec.bone.replace(/\./g, ""))!;
      const world = node.getWorldPosition(new THREE.Vector3());
      const turn = node.getWorldQuaternion(new THREE.Quaternion());
      const want = bones[i]!;
      expect(world.x, spec.bone).toBeCloseTo(want.position.x, 5);
      expect(world.y, spec.bone).toBeCloseTo(want.position.y, 5);
      expect(world.z, spec.bone).toBeCloseTo(want.position.z, 5);
      expect(turn.angleTo(quat(want.rotation)), spec.bone).toBeLessThan(1e-5);
    }
  });

  /**
   * The bug the rubber bench measured (2026-09-20): solving a bone's local
   * transform against a unit-scale matrix instead of the parent's real one
   * drew every bone at 58% of its offset from that parent — the torso sank
   * into the pelvis. The model's uniform scale has to come back out of the
   * inversion, which is only true when the real `matrixWorld` is used.
   */
  it("holds the body together whatever the model is scaled by", () => {
    const spread = (scale: number): number => {
      const { model, carrier } = fakeRig(scale);
      const rig = new RagdollRig(model, carrier);
      rig.pose(normalisedHeap());
      carrier.updateMatrixWorld(true);
      const pelvis = model.getObjectByName("pelvis")!.getWorldPosition(new THREE.Vector3());
      const head = model.getObjectByName("head")!.getWorldPosition(new THREE.Vector3());
      return pelvis.distanceTo(head);
    };
    expect(spread(0.58243)).toBeCloseTo(spread(1), 5);
    expect(spread(0.58243)).toBeCloseTo(spread(2.4), 5);
  });

  it("never scales a bone — a ragdoll owns where a bone is, not how big it is", () => {
    const { model, carrier } = fakeRig();
    new RagdollRig(model, carrier).pose(normalisedHeap());
    for (const spec of BLIP_RAGDOLL_SPEC.bones) {
      const node = model.getObjectByName(spec.bone.replace(/\./g, ""))!;
      expect(node.scale.toArray(), spec.bone).toEqual([1, 1, 1]);
    }
  });

  it("leaves the carrier where the caller put it — the bones carry the body themselves", () => {
    const { model, carrier } = fakeRig();
    carrier.position.set(2, 3, 4);
    new RagdollRig(model, carrier).pose(normalisedHeap());
    expect(carrier.position.toArray()).toEqual([2, 3, 4]);
  });

  it("puts the carrier back when the knockdown is over", () => {
    const { model, carrier } = fakeRig();
    const rig = new RagdollRig(model, carrier);
    rig.pose(normalisedHeap());
    rig.release(new THREE.Vector3(0, 1, 0));
    expect(carrier.position.toArray()).toEqual([0, 1, 0]);
  });
});

/** A heap: every bone somewhere of its own, turned its own way. */
const normalisedHeap = (): BoneSnapshot[] =>
  BLIP_RAGDOLL_SPEC.bones.map((spec, i) => {
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0.3, -0.2).normalize(), 1.4 + i * 0.2);
    return {
      position: { x: spec.rest.position.z + i * 0.11, y: 0.2 + (i % 3) * 0.05, z: 4 - spec.rest.position.y + i * 0.07 },
      rotation: { x: turn.x, y: turn.y, z: turn.z, w: turn.w },
    };
  });
