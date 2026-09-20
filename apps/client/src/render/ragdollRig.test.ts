import { type BoneSnapshot, RAGDOLL_BONES } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RagdollRig } from "./ragdollRig.js";

/**
 * A rig with the nodes BLIP has, at BLIP's own offsets — and, like BLIP,
 * naming its limbs from its own point of view, so `.L` hangs on negative x
 * (ADR 0071). A poser that trusted the names would mirror the body here.
 */
const fakeRig = (): { model: THREE.Object3D; carrier: THREE.Object3D } => {
  const carrier = new THREE.Group();
  const model = new THREE.Group();
  carrier.add(model);
  const node = (name: string, x: number, y: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, 0);
    model.add(o);
    return o;
  };
  node("pelvis", 0, -0.15);
  node("body", 0, 0.24);
  node("head", 0, 0.6);
  for (const [stem, y] of [
    ["upper_arm", 0.3],
    ["forearm", 0.02],
    ["thigh", -0.42],
    ["shin", -0.73],
  ] as const) {
    // BLIP's own convention: `L` on the negative side.
    node(`${stem}L`, -0.3, y);
    node(`${stem}R`, 0.3, y);
  }
  return { model, carrier };
};

const atRest = (): BoneSnapshot[] =>
  RAGDOLL_BONES.map((spec) => ({ position: { ...spec.restCenter }, rotation: { x: 0, y: 0, z: 0, w: 1 } }));

const indexOf = (name: string): number => RAGDOLL_BONES.findIndex((b) => b.name === name);

/** three.js keeps a quaternion's parts behind getters, so spreading one yields `_x`/`_y`/… and no `x`. */
const plain = (q: THREE.Quaternion): { x: number; y: number; z: number; w: number } => ({
  x: q.x,
  y: q.y,
  z: q.z,
  w: q.w,
});

describe("RagdollRig", () => {
  it("finds a rig node for every ragdoll bone", () => {
    const { model, carrier } = fakeRig();
    expect(new RagdollRig(model, carrier).complete).toBe(true);
  });

  it("says so when the rig is one it cannot draw", () => {
    const carrier = new THREE.Group();
    const model = new THREE.Group();
    carrier.add(model);
    expect(new RagdollRig(model, carrier).complete).toBe(false);
  });

  it("leaves the rig in its own pose when the ragdoll is at rest", () => {
    const { model, carrier } = fakeRig();
    new RagdollRig(model, carrier).pose(atRest());
    for (const child of model.children) {
      expect(child.quaternion.angleTo(new THREE.Quaternion()), child.name).toBeLessThan(1e-6);
    }
  });

  /**
   * The bug a name-to-name map would ship: `RAGDOLL_BONES` puts its own `L`
   * bones at **positive** x and BLIP puts `upper_armL` at negative, so turning
   * the ragdoll's left arm has to turn the rig node on the ragdoll's left
   * side — which is the one BLIP calls `R`.
   */
  it("poses by which side a limb is on, not by what it is called", () => {
    const { model, carrier } = fakeRig();
    const rig = new RagdollRig(model, carrier);
    const bones = atRest();
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7);
    bones[indexOf("upperArmL")] = { position: { x: 0.3, y: 0.3, z: 0 }, rotation: plain(turn) };
    rig.pose(bones);

    const positiveSide = model.getObjectByName("upper_armR")!; // BLIP's `R` hangs at +x
    const negativeSide = model.getObjectByName("upper_armL")!;
    expect(positiveSide.quaternion.angleTo(new THREE.Quaternion()), "the arm on +x turned").toBeGreaterThan(0.5);
    expect(negativeSide.quaternion.angleTo(new THREE.Quaternion()), "the other arm did not").toBeLessThan(1e-6);
  });

  it("carries the body to where the ragdoll's pelvis is", () => {
    const { model, carrier } = fakeRig();
    const rig = new RagdollRig(model, carrier);
    const bones = atRest();
    bones[0] = { position: { x: 3, y: 1.25, z: -2 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    rig.pose(bones);
    const rest = RAGDOLL_BONES[0]!.restCenter;
    expect(carrier.position.toArray()).toEqual([3 - rest.x, 1.25 - rest.y, -2 - rest.z]);
  });

  it("turns a bone to the rotation the ragdoll reports, in the model's own space", () => {
    const { model, carrier } = fakeRig();
    const rig = new RagdollRig(model, carrier);
    const bones = atRest();
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2);
    bones[indexOf("head")] = { position: { x: 0, y: 0.6, z: 0 }, rotation: plain(turn) };
    rig.pose(bones);
    const head = model.getObjectByName("head")!;
    expect(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(turn)).toBeLessThan(1e-6);
  });

  it("puts the carrier back when the knockout is over", () => {
    const { model, carrier } = fakeRig();
    const rig = new RagdollRig(model, carrier);
    const bones = atRest();
    bones[0] = { position: { x: 5, y: 0.2, z: 5 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    rig.pose(bones);
    rig.release(new THREE.Vector3(0, 1, 0));
    expect(carrier.position.toArray()).toEqual([0, 1, 0]);
  });
});
