import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RAGDOLL_BONES, type BoneSnapshot } from "@dont-fall/shared";
import { createRagdollPose } from "./ragdollPose.js";

/** The rig node names `ragdollPose` drives, in the order the ragdoll reports them. */
const NODES = [
  "Body", "Torso", "Head",
  "UpperArm.L", "LowerArm.L", "UpperArm.R", "LowerArm.R",
  "UpperLeg.L", "LowerLeg.L", "UpperLeg.R", "LowerLeg.R",
];

/**
 * A stand-in rig: the same node names in the same parent chain the real one
 * uses, with an unmapped node between the pelvis and the chest exactly as
 * `Abdomen` sits there — so the test covers the case a naive single pass
 * would get wrong.
 */
const buildRig = () => {
  const placed = new THREE.Group();
  const make = (name: string, parent: THREE.Object3D, y: number) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(0, y, 0);
    parent.add(o);
    return o;
  };
  const body = make("Body", placed, 0.85);
  const abdomen = make("Abdomen", body, 0.31); // unmapped, keeps its bind pose
  const torso = make("Torso", abdomen, 0.3);
  make("Head", torso, 0.59);
  for (const side of ["L", "R"] as const) {
    const shoulder = make(`Shoulder.${side}`, torso, 0.26); // unmapped too
    const upperArm = make(`UpperArm.${side}`, shoulder, 0.26);
    make(`LowerArm.${side}`, upperArm, 0.84);
    const upperLeg = make(`UpperLeg.${side}`, body, 0);
    make(`LowerLeg.${side}`, upperLeg, 0.42);
  }
  // Give the rig a bind pose that is *not* the ragdoll's upright rest, which
  // is the whole reason the anchor exists: arms out to the sides.
  placed.getObjectByName("UpperArm.L")!.rotation.z = -1.2;
  placed.getObjectByName("UpperArm.R")!.rotation.z = 1.2;
  placed.updateMatrixWorld(true);
  return placed;
};

const bonesAt = (rotation: THREE.Quaternion, pelvis = { x: 0, y: 0.5, z: 0 }): BoneSnapshot[] =>
  RAGDOLL_BONES.map((spec) => ({
    position: spec.name === "pelvis" ? pelvis : { x: 0, y: 0, z: 0 },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  }));

const worldQuat = (placed: THREE.Object3D, name: string): THREE.Quaternion => {
  placed.updateMatrixWorld(true);
  return placed.getObjectByName(name)!.getWorldQuaternion(new THREE.Quaternion());
};

describe("createRagdollPose", () => {
  it("leaves the rig exactly as it found it on the first frame of a knockdown", () => {
    // The anchor is taken now, so the fall starts from the pose the Character
    // was already in — a pop here would be visible on every knockdown.
    const placed = buildRig();
    const before = NODES.map((n) => worldQuat(placed, n).clone());

    const spun = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.9);
    createRagdollPose(placed).apply(bonesAt(spun));

    NODES.forEach((n, i) => expect(worldQuat(placed, n).angleTo(before[i]!)).toBeLessThan(1e-5));
  });

  it("turns every driven bone by exactly the physics rotation's own change", () => {
    const placed = buildRig();
    const pose = createRagdollPose(placed);
    const start = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    pose.apply(bonesAt(start)); // anchors here
    const anchored = NODES.map((n) => worldQuat(placed, n).clone());

    const later = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.1);
    pose.apply(bonesAt(later));

    // The physics turned 0.9 rad about X; every bone must have turned with it,
    // including the ones reached through an unmapped node.
    const delta = later.clone().multiply(start.clone().invert());
    NODES.forEach((n, i) => {
      const expected = delta.clone().multiply(anchored[i]!);
      expect(worldQuat(placed, n).angleTo(expected)).toBeLessThan(1e-5);
    });
  });

  it("never writes bone positions, so nothing can stretch", () => {
    const placed = buildRig();
    const lengths = () =>
      NODES.map((n) => placed.getObjectByName(n)!.position.length());
    const before = lengths();

    const pose = createRagdollPose(placed);
    pose.apply(bonesAt(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.4)));

    expect(lengths()).toEqual(before);
  });

  it("slides the rig so its pelvis sits where the simulation's pelvis is", () => {
    const placed = buildRig();
    const pose = createRagdollPose(placed);
    const target = { x: 3, y: 0.42, z: -2 };

    pose.apply(bonesAt(new THREE.Quaternion(), target));

    placed.updateMatrixWorld(true);
    const pelvis = placed.getObjectByName("Body")!.getWorldPosition(new THREE.Vector3());
    expect(pelvis.x).toBeCloseTo(target.x, 5);
    expect(pelvis.y).toBeCloseTo(target.y, 5);
    expect(pelvis.z).toBeCloseTo(target.z, 5);
  });

  it("takes a fresh anchor for the next knockdown after being released", () => {
    const placed = buildRig();
    const pose = createRagdollPose(placed);
    pose.apply(bonesAt(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2)));
    expect(pose.isPosing).toBe(true);

    pose.release();
    expect(pose.isPosing).toBe(false);
    // Back on its feet, animated somewhere new before the next knockdown.
    placed.getObjectByName("Torso")!.rotation.y = 0.8;
    placed.updateMatrixWorld(true);
    const standing = worldQuat(placed, "Torso").clone();

    pose.apply(bonesAt(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3)));

    expect(worldQuat(placed, "Torso").angleTo(standing)).toBeLessThan(1e-5);
  });

  it("ignores a snapshot that carries no skeleton", () => {
    const placed = buildRig();
    const before = worldQuat(placed, "Torso").clone();
    const pose = createRagdollPose(placed);

    pose.apply([]);

    expect(pose.isPosing).toBe(false);
    expect(worldQuat(placed, "Torso").angleTo(before)).toBeLessThan(1e-9);
  });
});
