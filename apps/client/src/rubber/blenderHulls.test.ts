import * as fs from "node:fs";
import * as path from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { GRAVITY_Y, initPhysics, TICK_DT } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { AUTHORED_SPECS, createBlipRagdoll, registerAuthoredSpec } from "./blipRagdoll.js";
import { BLENDER_COLLIDER_MODEL, specFromColliderScene } from "./blenderHulls.js";

/**
 * The Blender collider export, held to the same bar as the JSON rigs. The
 * numbers behind the v3 comparison (hull extents per bone, the ~5–10%
 * inflation) live in this file's console output rather than in gates — the
 * shapes are the artist's to change, the behaviour is not.
 */

beforeAll(async () => {
  await initPhysics();
});

const PAGE_SCALE = 0.5824;

const loadSpec = async (): Promise<ReturnType<typeof specFromColliderScene>> => {
  const raw = fs.readFileSync(path.resolve(import.meta.dirname, "../../public/models", path.basename(BLENDER_COLLIDER_MODEL)));
  const exact = new Uint8Array(raw.byteLength);
  exact.set(raw);
  const gltf = await new GLTFLoader().parseAsync(exact.buffer, "");
  return specFromColliderScene(gltf.scene, AUTHORED_SPECS.v3);
};

const world = (): RAPIER.World => {
  const w = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, 20),
    w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)),
  );
  return w;
};

describe("the Blender collider export as the authored rig v4", () => {
  it("finds a hull for every spec bone, reduced to its extreme points", async () => {
    const spec = await loadSpec();
    expect(spec.bodies).toHaveLength(15);
    for (const body of spec.bodies) {
      expect(body.collider.shape).toBe("convexHull");
      const points = body.collider.shape === "convexHull" ? body.collider.points : [];
      // The export carries 600–10700 mesh vertices per bone; the hull keeps
      // only what Rapier would keep, so a blow-up here means the reduction
      // stopped working.
      expect(points.length, `${body.bone} has a real hull`).toBeGreaterThan(3);
      expect(points.length, `${body.bone} was reduced`).toBeLessThan(500);
    }
    expect(spec.joints).toEqual(AUTHORED_SPECS.v3.joints);
  });

  it("spawns quiet at the page scale — the overlap filter absorbs the inflated shapes", async () => {
    registerAuthoredSpec("v4", await loadSpec());
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const doll = createBlipRagdoll(w, { scale: PAGE_SCALE, origin: new THREE.Vector3() }, "v4");
    for (let i = 0; i < 10; i += 1) w.step();
    let worst = 0;
    for (const body of doll.bodies.values()) {
      const v = body.linvel();
      worst = Math.max(worst, Math.hypot(v.x, v.y, v.z));
    }
    expect(worst).toBeLessThan(0.05);
    doll.dispose();
    w.free();
  });

  it("crumples at rest under gravity — it is not thrown", async () => {
    registerAuthoredSpec("v4", await loadSpec());
    const w = world();
    const doll = createBlipRagdoll(w, { scale: PAGE_SCALE, origin: new THREE.Vector3() }, "v4");
    let worst = 0;
    for (let i = 0; i < Math.round(6 / TICK_DT); i += 1) {
      w.step();
      for (const body of doll.bodies.values()) {
        const v = body.linvel();
        worst = Math.max(worst, Math.hypot(v.x, v.y, v.z));
      }
    }
    expect(worst).toBeLessThan(6);
    doll.dispose();
    w.free();
  });

  it("holds together as a body when it falls", async () => {
    registerAuthoredSpec("v4", await loadSpec());
    const w = world();
    const doll = createBlipRagdoll(w, { scale: 1, origin: new THREE.Vector3() }, "v4");
    const reach = (): number => {
      const head = doll.bodies.get("head")!.translation();
      const foot = doll.bodies.get("foot.L")!.translation();
      return Math.hypot(head.x - foot.x, head.y - foot.y, head.z - foot.z);
    };
    const standing = reach();
    doll.bodies.get("body")!.applyImpulse({ x: 12, y: 3, z: 0 }, true);
    for (let i = 0; i < Math.round(5 / TICK_DT); i += 1) w.step();
    expect(reach()).toBeGreaterThan(standing * 0.5);
    expect(reach()).toBeLessThan(standing * 1.4);
    doll.dispose();
    w.free();
  });

  it("reports which self-collision pairs each version gives up, v3 beside v4", async () => {
    registerAuthoredSpec("v4", await loadSpec());
    for (const version of ["v3", "v4"] as const) {
      const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
      const doll = createBlipRagdoll(w, { scale: PAGE_SCALE, origin: new THREE.Vector3() }, version);
      const bones = [...doll.bodies.keys()];
      const jointed = new Set(AUTHORED_SPECS.v3.joints.map((j) => [j.bodyA, j.bodyB].sort().join(" × ")));
      const dropped: string[] = [];
      for (const [name, body] of doll.bodies) {
        const filter = body.collider(0).collisionGroups() & 0xffff;
        for (const [i, other] of bones.entries()) {
          if (other <= name) continue;
          if ((filter & (1 << i)) === 0) {
            const key = [name, other].sort().join(" × ");
            const viaJoint = jointed.has(key) ? " (jointed anyway)" : "";
            dropped.push(`${key}${viaJoint}`);
          }
        }
      }
      console.log(`${version} rest-overlap pairs excluded from self-collision:\n  ${dropped.join("\n  ") || "none"}`);
      doll.dispose();
      w.free();
    }
    expect(true).toBe(true);
  });
});
