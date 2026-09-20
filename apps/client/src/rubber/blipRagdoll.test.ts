import RAPIER from "@dimforge/rapier3d-compat";
import { GRAVITY_Y, initPhysics, TICK_DT } from "@dont-fall/shared";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { AUTHORED_SPECS, type AuthoredVersion, BLIP_BONE_ORDER, createBlipRagdoll } from "./blipRagdoll.js";

beforeAll(async () => {
  await initPhysics();
});

const world = (): RAPIER.World => {
  const w = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, 20),
    w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)),
  );
  return w;
};

const placement = { scale: 1, origin: new THREE.Vector3() };

describe("the authored BLIP ragdoll", () => {
  it("builds a body for every bone the spec names, hands and feet included", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement);
    expect(doll.bodies.size).toBe(15);
    for (const bone of BLIP_BONE_ORDER) expect(doll.bodies.has(bone), bone).toBe(true);
    doll.dispose();
    w.free();
  });

  it("builds every joint, and limits the two elbows and two knees", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement);
    // 14 authored joints, plus two rope stops on each of the 9 ball joints
    // (the swing cone and the twist budget).
    expect(doll.joints).toHaveLength(14 + 9 * 2);
    const limited = doll.joints.filter((j) => j instanceof RAPIER.RevoluteImpulseJoint);
    expect(limited, "the neck, both elbows and both knees").toHaveLength(5);
    for (const joint of limited) {
      expect((joint as RAPIER.RevoluteImpulseJoint).limitsEnabled()).toBe(true);
    }
    doll.dispose();
    w.free();
  });

  it("puts each body at its own rig pivot, scaled and placed", () => {
    const w = world();
    const doll = createBlipRagdoll(w, { scale: 0.5, origin: new THREE.Vector3(2, 0, 0) });
    // `pelvis` is authored at (0, 0.68, 0).
    const pelvis = doll.bodies.get("pelvis")!.translation();
    expect(pelvis.x).toBeCloseTo(2, 6);
    expect(pelvis.y).toBeCloseTo(0.34, 6);
    doll.dispose();
    w.free();
  });

  // The user, 2026-09-20: "hlava se nesmí otáčet horizontálně, jen vertikálně".
  // A hinge on the body's left-right axis is exactly a nod and nothing else.
  it("lets the head nod but never turn", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement);
    const body = doll.bodies.get("body")!;
    const head = doll.bodies.get("head")!;
    // Pin the torso so only the neck can give.
    body.setBodyType(RAPIER.RigidBodyType.Fixed, true);

    const yawOf = (): number => {
      const r = head.rotation();
      return new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y;
    };
    const pitchOf = (): number => {
      const r = head.rotation();
      return new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").x;
    };

    // Wrung hard about the up axis, and nodded about the other.
    for (let i = 0; i < Math.round(2 / TICK_DT); i += 1) {
      head.applyTorqueImpulse({ x: 0.6, y: 3, z: 0 }, true);
      w.step();
    }
    expect(Math.abs(yawOf()), "never turns").toBeLessThan(0.05);
    expect(Math.abs(pitchOf()), "still nods").toBeGreaterThan(0.1);
    doll.dispose();
    w.free();
  });

  it("keeps the nod inside its limits", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement);
    const body = doll.bodies.get("body")!;
    const head = doll.bodies.get("head")!;
    body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    for (let i = 0; i < Math.round(3 / TICK_DT); i += 1) {
      head.applyTorqueImpulse({ x: 4, y: 0, z: 0 }, true);
      w.step();
    }
    const r = head.rotation();
    const pitch = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").x;
    expect(Math.abs(pitch)).toBeLessThan(0.75);
    doll.dispose();
    w.free();
  });

  it("holds together as a body when it falls", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement);
    const reach = (): number => {
      const head = doll.bodies.get("head")!.translation();
      const foot = doll.bodies.get("foot.L")!.translation();
      return Math.hypot(head.x - foot.x, head.y - foot.y, head.z - foot.z);
    };
    const standing = reach();
    doll.bodies.get("body")!.applyImpulse({ x: 12, y: 3, z: 0 }, true);
    for (let i = 0; i < Math.round(5 / TICK_DT); i += 1) w.step();
    // Not folded into a heap, and not flown apart either. The lower bound
    // was 0.6 when linear damping was 0.55 — a doll that froze mid-fall in
    // honey; at the shipped RAGDOLL_LINEAR_DAMPING it settles honestly, a
    // touch more folded (measured 0.59).
    expect(reach()).toBeGreaterThan(standing * 0.5);
    expect(reach()).toBeLessThan(standing * 1.4);
    doll.dispose();
    w.free();
  });

  // v3: every bone is a convex hull wrapped around the points the artist
  // modelled, rather than the nearest primitive to them.
  it("builds v3 out of hulls, one per bone, and none of them empty", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement, "v3");
    expect(doll.bodies.size).toBe(15);
    for (const body of doll.bodies.values()) {
      expect(body.numColliders(), "every bone got a hull").toBe(1);
      const collider = body.collider(0);
      expect(collider.shape.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
    }
    doll.dispose();
    w.free();
  });

  it("keeps v3's neck motor and limits", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement, "v3");
    const limited = doll.joints.filter((j) => j instanceof RAPIER.RevoluteImpulseJoint);
    expect(limited.length).toBeGreaterThan(0);
    for (const joint of limited) {
      expect((joint as RAPIER.RevoluteImpulseJoint).limitsEnabled()).toBe(true);
    }
    doll.dispose();
    w.free();
  });

  it("holds v3 together as a body when it falls", () => {
    const w = world();
    const doll = createBlipRagdoll(w, placement, "v3");
    const reach = (): number => {
      const head = doll.bodies.get("head")!.translation();
      const foot = doll.bodies.get("foot.L")!.translation();
      return Math.hypot(head.x - foot.x, head.y - foot.y, head.z - foot.z);
    };
    const standing = reach();
    doll.bodies.get("body")!.applyImpulse({ x: 12, y: 3, z: 0 }, true);
    for (let i = 0; i < Math.round(5 / TICK_DT); i += 1) w.step();
    // 0.5 for the same reason as v1's: the shipped damping lets it settle.
    expect(reach()).toBeGreaterThan(standing * 0.5);
    expect(reach()).toBeLessThan(standing * 1.4);
    doll.dispose();
    w.free();
  });

  // The page runs the doll at CHARACTER_VISUAL_HEIGHT / the GLB's own height.
  const PAGE_SCALE = 0.5824;

  /**
   * The gates the diagnosis of 2026-09-20 earned. A freshly built doll in a
   * world with no gravity has nothing to move it — any velocity on the first
   * steps is the build fighting itself, and each of these was measured doing
   * exactly that: elbows built on one shared local axis snapped 33.5° shut,
   * knees rested 0.21 rad outside their own limits, v3's head hull overlapped
   * both shoulders (arms thrown at up to 13.6 u/s), and v1's feet spawned
   * inside the floor and their own thighs.
   */
  for (const version of ["v1", "v2", "v3"] as AuthoredVersion[]) {
    it(`${version} spawns quiet — nothing in the build kicks its own bones`, () => {
      const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
      const doll = createBlipRagdoll(w, { scale: PAGE_SCALE, origin: new THREE.Vector3() }, version);
      for (let i = 0; i < 10; i += 1) w.step();
      let worst = 0;
      for (const body of doll.bodies.values()) {
        const v = body.linvel();
        worst = Math.max(worst, Math.hypot(v.x, v.y, v.z));
      }
      expect(worst, "a built doll left alone stays still").toBeLessThan(0.05);
      doll.dispose();
      w.free();
    });
  }

  it("v3 at rest under gravity crumples — it is not thrown", () => {
    const w = world();
    const doll = createBlipRagdoll(w, { scale: PAGE_SCALE, origin: new THREE.Vector3() }, "v3");
    let worst = 0;
    for (let i = 0; i < Math.round(6 / TICK_DT); i += 1) {
      w.step();
      for (const body of doll.bodies.values()) {
        const v = body.linvel();
        worst = Math.max(worst, Math.hypot(v.x, v.y, v.z));
      }
    }
    // Untouched it reached 9.8 u/s (a hurled arm); a crumple stays gentle.
    expect(worst).toBeLessThan(6);
    doll.dispose();
    w.free();
  });

  /**
   * The hinge still hinges after the per-body axes and the rest-shifted
   * limits: torqued about its own world axis, the forearm swings far into the
   * bend the spec allows and is stopped almost flat against the other side.
   */
  it("the elbow bends its full range one way and almost none the other", () => {
    const swingUnder = (torqueSign: number): number => {
      const w = world();
      const doll = createBlipRagdoll(w, placement);
      const upper = doll.bodies.get("upper_arm.L")!;
      const fore = doll.bodies.get("forearm.L")!;
      upper.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      const spec = AUTHORED_SPECS.v1;
      const [qx, qy, qz, qw] = spec.bodies.find((b) => b.bone === "upper_arm.L")!.restWorld.rotation;
      const worldAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(qx, qy, qz, qw));
      const restQ = fore.rotation();
      const rest = new THREE.Quaternion(restQ.x, restQ.y, restQ.z, restQ.w);
      for (let i = 0; i < Math.round(2 / TICK_DT); i += 1) {
        fore.applyTorqueImpulse(
          { x: worldAxis.x * torqueSign, y: worldAxis.y * torqueSign, z: worldAxis.z * torqueSign },
          true,
        );
        w.step();
      }
      const q = fore.rotation();
      // How far the forearm has turned from rest, about the hinge axis.
      const delta = new THREE.Quaternion(q.x, q.y, q.z, q.w).multiply(rest.clone().invert());
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const twist = 2 * Math.atan2(delta.x * worldAxis.x + delta.y * worldAxis.y + delta.z * worldAxis.z, delta.w);
      doll.dispose();
      w.free();
      return twist;
    };
    const swings = [swingUnder(1), swingUnder(-1)];
    const most = Math.max(...swings.map(Math.abs));
    const least = Math.min(...swings.map(Math.abs));
    // Limits are [-0.15, 2.55] about the rest pose: a full bend one way,
    // barely past straight the other.
    expect(most, "bends far").toBeGreaterThan(1.5);
    expect(most).toBeLessThan(2.8);
    expect(least, "stops almost flat the other way").toBeLessThan(0.4);
  });

  it("takes everything it made back out of the world", () => {
    const w = world();
    const before = w.bodies.len();
    const doll = createBlipRagdoll(w, placement);
    expect(w.bodies.len()).toBe(before + 15);
    doll.dispose();
    expect(w.bodies.len()).toBe(before);
    w.free();
  });
});
