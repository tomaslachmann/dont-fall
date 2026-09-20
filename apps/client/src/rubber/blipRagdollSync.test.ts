import * as fs from "node:fs";
import * as path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { GRAVITY_Y, initPhysics, TICK_DT } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { CHARACTER_VISUAL_HEIGHT } from "../render/characterModel.js";
import {
  type AuthoredVersion,
  BLIP_BONE_ORDER,
  createBlipRagdoll,
  syncBlipSkeletonFromRagdoll,
} from "./blipRagdoll.js";

/**
 * Mesh-sync fidelity for the authored BLIP ragdoll, headless: after
 * `syncBlipSkeletonFromRagdoll`, every GLB bone must sit ON the Rapier body
 * it is meant to sit on — at rest and mid-fall, at the page's real scale.
 *
 * This is the seam the page's look lives in and the physics suite cannot
 * see. Before the fix the six torso-adjacent bones were drawn at 58% of
 * their offset from their parents (a unit-scale physics matrix used as a
 * parent frame under a scale-carrying rig), which sank the head and
 * shoulders 0.32–0.36 m into the pelvis while every limb end stayed exact.
 *
 * The scene is placed exactly as `main.ts` places it: scaled to
 * CHARACTER_VISUAL_HEIGHT, lowered by `-bounds.min.y * scale`, in a Group at
 * the origin — and the ragdoll's origin lowered the same way.
 */

beforeAll(async () => {
  await initPhysics();
});

interface PlacedScene {
  scene: THREE.Group;
  scale: number;
  origin: THREE.Vector3;
}

const loadPlacedScene = async (): Promise<PlacedScene> => {
  const raw = fs.readFileSync(path.resolve(import.meta.dirname, "../../public/models/BLIP.glb"));
  const exact = new Uint8Array(raw.byteLength);
  exact.set(raw);
  const gltf = await new GLTFLoader().parseAsync(exact.buffer, "");
  const scene = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3()).y;
  const scale = size > 0 ? CHARACTER_VISUAL_HEIGHT / size : 1;
  scene.scale.setScalar(scale);
  scene.position.y = -bounds.min.y * scale;
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  wrapper.updateMatrixWorld(true);
  return { scene, scale, origin: new THREE.Vector3(0, scene.position.y, 0) };
};

const makeWorld = (): RAPIER.World => {
  const w = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, 20),
    w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)),
  );
  return w;
};

/** The exact bone lookup the sync performs — GLTFLoader strips the dots. */
const lookupBone = (root: THREE.Object3D, name: string): THREE.Bone | null => {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  return bones.get(name.replace(/\./g, "")) ?? bones.get(name) ?? null;
};

/** Worst distance between a spec bone and its physics body, over all 15. */
const worstError = (scene: THREE.Object3D, doll: ReturnType<typeof createBlipRagdoll>): number => {
  scene.updateMatrixWorld(true);
  const pos = new THREE.Vector3();
  let worst = 0;
  for (const name of BLIP_BONE_ORDER) {
    const bone = lookupBone(scene, name);
    const body = doll.bodies.get(name);
    expect(bone, `${name} maps to a GLB bone`).not.toBeNull();
    expect(body, `${name} has a body`).toBeDefined();
    bone!.getWorldPosition(pos);
    const t = body!.translation();
    worst = Math.max(worst, Math.hypot(pos.x - t.x, pos.y - t.y, pos.z - t.z));
  }
  return worst;
};

describe("authored-ragdoll mesh sync", () => {
  for (const version of ["v1", "v3"] as AuthoredVersion[]) {
    it(`${version}: the placed bind pose already agrees with the built bodies`, async () => {
      const placed = await loadPlacedScene();
      const world = makeWorld();
      const doll = createBlipRagdoll(world, placed, version);
      // No sync has run: this gates the placement itself — spec restWorld,
      // page scale AND the lowered origin all telling the same story.
      expect(worstError(placed.scene, doll)).toBeLessThan(0.005);
      doll.dispose();
      world.free();
    });

    it(`${version}: at rest, one sync puts every bone on its body`, async () => {
      const placed = await loadPlacedScene();
      const world = makeWorld();
      const doll = createBlipRagdoll(world, placed, version);
      syncBlipSkeletonFromRagdoll(placed.scene, doll);
      expect(worstError(placed.scene, doll)).toBeLessThan(0.005);
      doll.dispose();
      world.free();
    });

    it(`${version}: after 2 s of falling, synced every step, bones still track bodies`, async () => {
      const placed = await loadPlacedScene();
      const world = makeWorld();
      const doll = createBlipRagdoll(world, placed, version);
      for (let i = 0; i < Math.round(2 / TICK_DT); i += 1) {
        world.step();
        syncBlipSkeletonFromRagdoll(placed.scene, doll);
      }
      expect(worstError(placed.scene, doll)).toBeLessThan(0.005);
      doll.dispose();
      world.free();
    });
  }
});
