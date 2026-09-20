import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { conjugateQuat, mulQuat, type Quat } from "../../math/quat.js";
import { dotVec3, rotateVec3ByQuat, type Vec3 } from "../../math/vec3.js";
import { GRAVITY_Y } from "../../tuning/character.js";
import { TICK_DT } from "../../tuning/clock.js";
import { initPhysics } from "../RapierSimulation.js";
import { AuthoredRagdoll } from "./AuthoredRagdoll.js";
import { BLIP_RAGDOLL_SPEC } from "./blipRagdollSpec.js";

beforeAll(async () => {
  await initPhysics();
});

const floored = (): RAPIER.World => {
  const w = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, 20),
    w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)),
  );
  return w;
};

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
/** A capsule centre whose feet rest on the floor at y 0. */
const ROOT: Vec3 = { x: 0, y: 0.85, z: 0 };

const indexOf = (name: string): number => BLIP_RAGDOLL_SPEC.bones.findIndex((b) => b.bone === name);
const specOf = (name: string) => BLIP_RAGDOLL_SPEC.bones.find((b) => b.bone === name)!;

/** The world direction a bone's own Y axis points under `rotation`. */
const boneAxis = (rotation: Quat): Vec3 => rotateVec3ByQuat({ x: 0, y: 1, z: 0 }, rotation);

const angleBetween = (a: Vec3, b: Vec3): number => {
  const dot = dotVec3(a, b) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.max(-1, Math.min(1, dot)));
};

/** How far `rotation` has twisted from `rest`, about the world `axis` (rad, absolute). */
const twistAbout = (rotation: RAPIER.Rotation, rest: Quat, axis: Vec3): number => {
  const delta = mulQuat({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, conjugateQuat(rest));
  const flipped = delta.w < 0 ? { x: -delta.x, y: -delta.y, z: -delta.z, w: -delta.w } : delta;
  return Math.abs(2 * Math.atan2(flipped.x * axis.x + flipped.y * axis.y + flipped.z * axis.z, flipped.w));
};

describe("the authored BLIP ragdoll (.scratch/physical-ragdoll ticket 01)", () => {
  it("builds a body for every spec bone, hands and feet included, in wire order", () => {
    const w = floored();
    const doll = new AuthoredRagdoll(w);
    doll.activate(ROOT, 0, ZERO, ZERO);
    const bones = doll.readBones();
    expect(bones).toHaveLength(15);
    expect(BLIP_RAGDOLL_SPEC.bones[0]!.bone).toBe("pelvis");
    expect(doll.rootPosition().y).toBeCloseTo(bones[0]!.position.y, 6);
    for (const name of ["hand.L", "hand.R", "foot.L", "foot.R"]) {
      expect(doll.bodyOf(name), name).toBeDefined();
    }
    doll.dispose();
    w.free();
  });

  it("activates the rest pose around the root, turned to the yaw it is given", () => {
    const w = floored();
    const doll = new AuthoredRagdoll(w);
    doll.activate({ x: 3, y: 0.85, z: -2 }, Math.PI / 2, ZERO, ZERO);
    const bones = doll.readBones();
    const head = bones[indexOf("head")]!;
    // The head sits straight above the pelvis whatever the yaw…
    expect(head.position.x).toBeCloseTo(3, 5);
    expect(head.position.z).toBeCloseTo(-2, 5);
    expect(head.position.y).toBeCloseTo(0.85 + specOf("head").rest.position.y, 5);
    // …and an arm swings around with the turn: at yaw π/2 the rest pose's +X
    // lands on world −Z (three.js yaw), so the left hand's x offset becomes z.
    const hand = bones[indexOf("hand.L")]!;
    expect(hand.position.z - -2).toBeCloseTo(-specOf("hand.L").rest.position.x, 4);
    doll.dispose();
    w.free();
  });

  /**
   * The gate the rubber bench earned (2026-09-20): a freshly built doll in a
   * world with no gravity has nothing to move it — any velocity on the first
   * steps is the build fighting itself. Each of these was measured doing
   * exactly that before the recipe: elbows built on one shared local axis
   * snapped 33.5° shut, knees rested outside their own rest-shifted limits,
   * and the head hull overlapping both shoulders threw the arms at up to
   * 13.6 u/s with nobody touching the doll.
   */
  it("spawns quiet — nothing in the build kicks its own bones", () => {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const doll = new AuthoredRagdoll(w);
    doll.activate(ROOT, 0.7, ZERO, ZERO);
    for (let i = 0; i < 10; i += 1) w.step();
    expect(doll.maxSpeed(), "a built doll left alone stays still").toBeLessThan(0.05);
    doll.dispose();
    w.free();
  });

  it("holds together as a body when it falls", () => {
    const w = floored();
    const doll = new AuthoredRagdoll(w);
    doll.activate(ROOT, 0, ZERO, ZERO);
    const reach = (): number => {
      const bones = doll.readBones();
      const head = bones[indexOf("head")]!.position;
      const foot = bones[indexOf("foot.L")]!.position;
      return Math.hypot(head.x - foot.x, head.y - foot.y, head.z - foot.z);
    };
    const standing = reach();
    doll.applyImpulse({ x: 12, y: 3, z: 0 });
    for (let i = 0; i < Math.round(5 / TICK_DT); i += 1) w.step();
    // Not folded into a heap (ADR 0047's lump), and not flown apart either.
    expect(reach()).toBeGreaterThan(standing * 0.5);
    expect(reach()).toBeLessThan(standing * 1.4);
    doll.dispose();
    w.free();
  });

  // The user, 2026-09-20: "jak vyřešit přetáčení rukou v kloubech? to nesmí
  // jít." The rope stops are what answers it — these three pin them.
  it("stops an arm at its shoulder's swing cone — it cannot orbit through the torso", () => {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const doll = new AuthoredRagdoll(w);
    doll.activate(ROOT, 0, ZERO, ZERO);
    doll.bodyOf("body")!.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    const arm = doll.bodyOf("upper_arm.L")!;
    const restAxis = boneAxis(specOf("upper_arm.L").rest.rotation);
    for (let i = 0; i < Math.round(3 / TICK_DT); i += 1) {
      // Torqued about the body's forward axis: a pure swing, trying to windmill.
      arm.applyTorqueImpulse({ x: 0, y: 0, z: 0.8 }, true);
      w.step();
    }
    const swing = angleBetween(boneAxis(arm.rotation()), restAxis);
    // The baked shoulder cone is 1.4 rad; the rope is a chord, so a little
    // solver give past it is honest — a windmill (π) is not.
    expect(swing).toBeLessThan(1.4 + 0.4);
    doll.dispose();
    w.free();
  });

  it("keeps a hand from winding up on its wrist without end", () => {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const doll = new AuthoredRagdoll(w);
    doll.activate(ROOT, 0, ZERO, ZERO);
    doll.bodyOf("forearm.L")!.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    const hand = doll.bodyOf("hand.L")!;
    const rest = specOf("hand.L").rest.rotation;
    const axis = boneAxis(rest);
    for (let i = 0; i < Math.round(3 / TICK_DT); i += 1) {
      hand.applyTorqueImpulse({ x: axis.x * 0.5, y: axis.y * 0.5, z: axis.z * 0.5 }, true);
      w.step();
    }
    // The wrist's budget is swing 0.9 + twist 0.6; unlimited it wound many
    // full turns ("to nesmí jít").
    expect(twistAbout(hand.rotation(), rest, axis)).toBeLessThan(2.2);
    doll.dispose();
    w.free();
  });

  it("bends the elbow its full range one way and almost none the other", () => {
    const swingUnder = (torqueSign: number): number => {
      const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
      const doll = new AuthoredRagdoll(w);
      doll.activate(ROOT, 0, ZERO, ZERO);
      const upper = doll.bodyOf("upper_arm.L")!;
      const fore = doll.bodyOf("forearm.L")!;
      upper.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      // The joint alone is on trial: a full fold sweeps the (inflated) hand
      // through the torso's own hull, and that honest self-collision stopped
      // the bend at 1.25 rad — so the flesh is taken off for the measurement.
      for (const name of ["body", "head", "pelvis"]) doll.bodyOf(name)!.collider(0).setEnabled(false);
      const joint = BLIP_RAGDOLL_SPEC.joints.find(
        (j) => j.type === "revolute" && j.a === "upper_arm.L" && j.b === "forearm.L",
      );
      expect(joint?.type).toBe("revolute");
      const axisA = joint!.type === "revolute" ? joint!.axisA : { x: 1, y: 0, z: 0 };
      const worldAxis = rotateVec3ByQuat(axisA, specOf("upper_arm.L").rest.rotation);
      const rest = { ...fore.rotation() };
      for (let i = 0; i < Math.round(2 / TICK_DT); i += 1) {
        fore.applyTorqueImpulse(
          { x: worldAxis.x * torqueSign, y: worldAxis.y * torqueSign, z: worldAxis.z * torqueSign },
          true,
        );
        w.step();
      }
      const twist = twistAbout(fore.rotation(), rest, worldAxis);
      doll.dispose();
      w.free();
      return twist;
    };
    const swings = [swingUnder(1), swingUnder(-1)];
    const most = Math.max(...swings);
    const least = Math.min(...swings);
    // The authored limits are [-0.15, 2.55] about the rest pose: a full bend
    // one way, barely past straight the other.
    expect(most, "bends far").toBeGreaterThan(1.5);
    expect(most).toBeLessThan(2.8);
    expect(least, "stops almost flat the other way").toBeLessThan(0.4);
  });

  it("lets the head nod but never turn", () => {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const doll = new AuthoredRagdoll(w);
    doll.activate(ROOT, 0, ZERO, ZERO);
    doll.bodyOf("body")!.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    const head = doll.bodyOf("head")!;
    for (let i = 0; i < Math.round(2 / TICK_DT); i += 1) {
      head.applyTorqueImpulse({ x: 0.6, y: 3, z: 0 }, true);
      w.step();
    }
    const rest = specOf("head").rest.rotation;
    const turn = twistAbout(head.rotation(), rest, { x: 0, y: 1, z: 0 });
    const nod = twistAbout(head.rotation(), rest, { x: 1, y: 0, z: 0 });
    expect(turn, "never turns").toBeLessThan(0.06);
    expect(nod, "still nods").toBeGreaterThan(0.1);
    // …and the nod respects the authored neck limit (±0.1745 + solver give).
    expect(nod).toBeLessThan(0.35);
    doll.dispose();
    w.free();
  });

  it("takes everything it made back out of the world", () => {
    const w = floored();
    const before = w.bodies.len();
    const doll = new AuthoredRagdoll(w);
    expect(w.bodies.len()).toBe(before + 15);
    doll.dispose();
    expect(w.bodies.len()).toBe(before);
    w.free();
  });
});
