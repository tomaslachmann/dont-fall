import * as fs from "node:fs";
import * as path from "node:path";
import { RAGDOLL_BONES } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { findArmReachNodes } from "./armReach.js";
import { createRagdollPose } from "./ragdollPose.js";

const MODEL_PATH = path.resolve(import.meta.dirname, "../../public/models/MushroomKing.gltf");

/**
 * Loads the REAL MushroomKing asset (M6.1 ticket 05, code review) — every
 * other test touching bone names (`armReach.test.ts`, `ragdollPose.test.ts`)
 * builds its own synthetic rig, which can only ever be as correct as the
 * name convention its author assumed. That assumption was wrong: the source
 * .gltf's own `nodes[].name` field carries a `.` (`UpperArm.L`), but
 * `GLTFLoader` strips it when constructing the scene graph (the real node is
 * `UpperArmL`) — almost certainly because `AnimationClip` track paths are
 * themselves dot-separated `nodeName.property` strings. Both `armReach.ts`
 * and `ragdollPose.ts` were built against the dotted (wrong) names and
 * silently matched nothing against the real model — found live ("Grab
 * visibly does nothing"), not by any of this codebase's existing tests. This
 * file exists so a future rename, asset swap, or copy-pasted dotted name
 * fails loudly here instead.
 */
describe("MushroomKing.gltf — real model, real bone names", () => {
  let scene: THREE.Object3D;

  beforeAll(async () => {
    const json = fs.readFileSync(MODEL_PATH, "utf-8");
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      new GLTFLoader().parse(json, path.dirname(MODEL_PATH) + "/", resolve, reject);
    });
    scene = gltf.scene;
  });

  it("findArmReachNodes finds both arms, each with a lower arm too (M6.1 ticket 05, Grab's arm-reach)", () => {
    const nodes = findArmReachNodes(scene);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.lowerArm !== undefined)).toBe(true);
  });

  it("createRagdollPose actually drives the arm bones, not just pelvis/chest/head (M6.1 ticket 02)", () => {
    const pose = createRagdollPose(scene);
    const upperArmL = scene.getObjectByName("UpperArmL")!;
    // Every OTHER driven bone (pelvis/chest/head/the right arm) holds still
    // at identity; only upperArmL's own rotation varies between the two
    // calls below. A uniform rotation shared by every bone was tried first
    // and is wrong: rotating the whole rig rigidly by the same delta doesn't
    // change any *joint's* relative orientation, so upperArmL's world
    // quaternion changes right along with its parent even if upperArmL's
    // own node were never found at all — exactly the false positive that
    // let this exact bug slip past an earlier draft of this test. Isolating
    // upperArmL's own rotation is what actually proves *this* bone is found
    // and driven, not merely dragged along by an ancestor.
    const bonesAt = (upperArmLRotation: THREE.Quaternion) =>
      RAGDOLL_BONES.map((spec) => ({
        position: spec.name === "pelvis" ? { x: 0, y: 0.5, z: 0 } : { x: 0, y: 0, z: 0 },
        rotation:
          spec.name === "upperArmL"
            ? { x: upperArmLRotation.x, y: upperArmLRotation.y, z: upperArmLRotation.z, w: upperArmLRotation.w }
            : { x: 0, y: 0, z: 0, w: 1 },
      }));

    // The first `apply` only anchors (see that method's own doc comment) —
    // it deliberately leaves the rig exactly as it found it, so the second
    // call, with a different rotation, is what actually proves movement.
    pose.apply(bonesAt(new THREE.Quaternion()));
    const before = upperArmL.getWorldQuaternion(new THREE.Quaternion()).clone();
    pose.apply(bonesAt(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.0)));
    const after = upperArmL.getWorldQuaternion(new THREE.Quaternion());

    // Before this fix, UpperArmL was never found (`Object3D.getObjectByName`
    // returned undefined for the dotted "UpperArm.L"), so `apply` silently
    // never touched it at all — this would read as `angleTo` === 0.
    expect(after.angleTo(before)).toBeGreaterThan(0.1);
  });
});
