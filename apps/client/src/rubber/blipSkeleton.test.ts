import * as fs from "node:fs";
import * as path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { type BoneSnapshot, type BoneSpec, GRAVITY_Y, initPhysics, Ragdoll, TICK_DT } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { CHARACTER_VISUAL_HEIGHT } from "../render/characterModel.js";
import { skeletonFromRig } from "./skeletonFromRig.js";
import { BLIP_BODY_HALF_WIDTH, BLIP_RAGDOLL_BONES, SKELETONS } from "./blipSkeleton.js";

beforeAll(async () => {
  await initPhysics();
});

const feetOnFloor = (bones: readonly BoneSpec[]): number =>
  Math.max(...bones.map((b) => -(b.restCenter.y - b.halfHeight - b.radius)));

/** A skeleton standing on a floor, knocked over by `impulse` and left for `seconds`. */
const collapse = (bones: readonly BoneSpec[], impulse: { x: number; y: number; z: number }, seconds: number): BoneSnapshot[] => {
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, 20),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)),
  );
  const ragdoll = new Ragdoll(world, bones);
  ragdoll.activate({ x: 0, y: feetOnFloor(bones), z: 0 }, { x: 0, y: 0, z: 0 }, impulse);
  for (let i = 0; i < Math.round(seconds / TICK_DT); i += 1) world.step();
  const settled = ragdoll.readBones();
  ragdoll.dispose();
  world.free();
  return settled;
};

const at = (bones: readonly BoneSpec[], settled: readonly BoneSnapshot[], name: string): BoneSnapshot =>
  settled[bones.findIndex((b) => b.name === name)]!;

/** |cos| between the chest's own front-to-back axis and world up: 1 lying on a face, 0 on its side. */
const onItsFace = (bones: readonly BoneSpec[], settled: readonly BoneSnapshot[]): number => {
  const { x, y, z, w } = at(bones, settled, "chest").rotation;
  return Math.abs(2 * (y * z - w * x));
};

/** Every landing, twenty-four ways round the compass. */
const landings = (bones: readonly BoneSpec[]): number[] =>
  Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return onItsFace(bones, collapse(bones, { x: Math.sin(a) * 26, y: 6, z: Math.cos(a) * 26 }, 6));
  });

describe("a BLIP-shaped ragdoll (demo only — the game's is untouched)", () => {
  it("is built by the same class the Match uses, just handed a different skeleton", () => {
    expect(SKELETONS.game.bones).not.toBe(SKELETONS.blip.bones);
    expect(SKELETONS.blip.bones.map((b) => b.name)).toEqual(SKELETONS.game.bones.map((b) => b.name));
  });

  it("hangs its arms off the outside of the torso, not inside it", () => {
    // Grazing the surface is fine and wanted — an arm tucked against the body
    // is how the bean stands. What must never happen is an arm whose *centre*
    // is inside the torso, because from there it has nothing to collide with
    // on the way further in. Pushed right out instead (x 1.0, fully clear) the
    // arms turn into outriggers and the worst landing falls from 0.57 to 0.30,
    // so "clear" is deliberately "centre outside", not "no overlap".
    const chest = BLIP_RAGDOLL_BONES.find((b) => b.name === "chest")!;
    for (const arm of ["upperArmL", "upperArmR", "lowerArmL", "lowerArmR"]) {
      const bone = BLIP_RAGDOLL_BONES.find((b) => b.name === arm)!;
      expect(Math.abs(bone.restCenter.x), `${arm} hangs outside the torso`).toBeGreaterThan(chest.radius);
    }
    expect(chest.radius).toBe(BLIP_BODY_HALF_WIDTH);
  });

  it("is flatter front to back than it is wide — the reason it has a back to land on", () => {
    for (const name of ["pelvis", "chest"]) {
      const bone = BLIP_RAGDOLL_BONES.find((b) => b.name === name)!;
      expect(bone.depth, name).toBeDefined();
      expect(bone.depth!).toBeLessThan(bone.radius);
    }
  });

  /**
   * The comparison this file exists for, recorded rather than gated — the
   * numbers are the user's to settle, and they are settling them.
   *
   * What it measures is the skeleton the demo actually starts from: the one
   * derived from the rig in `BLIP.glb`, where a limb is a capsule spanning
   * from its own joint to its child's and turned the way the rig turns it.
   * The written table is measured beside it, and is what hand-tuning the
   * *previous* structure produced — blobs centred on the joints, before the
   * user pointed out that a rig's bones are segments between rotators.
   */
  it("measures the rig-derived skeleton, the written one and the game's, side by side", async () => {
    const raw = fs.readFileSync(path.resolve(import.meta.dirname, "../../public/models/BLIP.glb"));
    const exact = new Uint8Array(raw.byteLength);
    exact.set(raw);
    const { scene } = await new GLTFLoader().parseAsync(exact.buffer, "");
    const bounds = new THREE.Box3().setFromObject(scene);
    scene.scale.setScalar(CHARACTER_VISUAL_HEIGHT / bounds.getSize(new THREE.Vector3()).y);
    scene.updateMatrixWorld(true);

    for (const [label, bones] of [
      ["from the rig", skeletonFromRig(scene)],
      ["written table", BLIP_RAGDOLL_BONES],
      ["the game's", SKELETONS.game.bones],
    ] as const) {
      const values = landings(bones);
      console.log(
        `${label.padEnd(14)} worst ${Math.min(...values).toFixed(2)}  flat ${values.filter((v) => v > 0.9).length}/24`,
      );
      expect(values).toHaveLength(24);
    }
  });
});
