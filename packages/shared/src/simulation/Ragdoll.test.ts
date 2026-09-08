import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { GRAVITY_Y, HIT_CHARGE_IMPACT_BONUS, HIT_IMPACT_MAGNITUDE, HIT_LIFT_RATIO, TICK_DT } from "../tuning.js";
import { STATIC_GROUPS } from "./collisionGroups.js";
import { Ragdoll } from "./Ragdoll.js";
import { RAGDOLL_BONES, type BoneSnapshot } from "./ragdollSkeleton.js";
import { initPhysics } from "./RapierSimulation.js";

beforeAll(async () => {
  await initPhysics();
});

const ZERO = { x: 0, y: 0, z: 0 };

/** Pelvis→head distance in the authored standing pose — the shape a body has to hold. */
const STANDING_SPREAD = Math.abs(
  RAGDOLL_BONES.find((b) => b.name === "head")!.restCenter.y -
    RAGDOLL_BONES.find((b) => b.name === "pelvis")!.restCenter.y,
);

/**
 * The root height at which the lowest bone's capsule just touches y = 0.
 * Activating any higher would make the skeleton *drop*, and the drop — not the
 * joints — would be what the test measures.
 */
const FEET_ON_FLOOR = Math.max(...RAGDOLL_BONES.map((b) => -(b.restCenter.y - b.halfHeight - b.radius)));

const bone = (bones: readonly BoneSnapshot[], name: string): BoneSnapshot =>
  bones[RAGDOLL_BONES.findIndex((b) => b.name === name)]!;

const spread = (bones: readonly BoneSnapshot[]): number => {
  const head = bone(bones, "head").position;
  const pelvis = bone(bones, "pelvis").position;
  return Math.hypot(head.x - pelvis.x, head.y - pelvis.y, head.z - pelvis.z);
};

/** A ragdoll standing on a floor, collapsed under `impulse` for `seconds`. */
const collapse = (impulse: { x: number; y: number; z: number }, seconds: number): BoneSnapshot[] => {
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setCollisionGroups(STATIC_GROUPS), ground);

  const ragdoll = new Ragdoll(world);
  ragdoll.activate({ x: 0, y: FEET_ON_FLOOR, z: 0 }, ZERO, impulse);
  for (let i = 0; i < Math.round(seconds / TICK_DT); i += 1) world.step();
  const bones = ragdoll.readBones();
  ragdoll.dispose();
  world.free();
  return bones;
};

describe("Ragdoll — it settles as a body, not a heap (M6 ticket 05)", () => {
  it("starts in the authored standing pose", () => {
    // Nothing here should depend on a drop: at t = 0 the skeleton is exactly
    // the pose `RAGDOLL_BONES` describes, with its feet on the floor.
    expect(spread(collapse(ZERO, 0))).toBeCloseTo(STANDING_SPREAD, 5);
  });

  it("keeps its pelvis and head apart after collapsing under gravity alone", () => {
    // The purest form of the question — no blow, just a Character going down.
    // Free ball joints let the whole skeleton fold into a point here.
    const settled = spread(collapse(ZERO, 3.5));

    expect(settled).toBeGreaterThan(STANDING_SPREAD * 0.9);
  });

  it("keeps its shape however it is knocked down", () => {
    const directions = [
      { x: 26, y: 6, z: 0 },
      { x: -26, y: 6, z: 0 },
      { x: 0, y: 6, z: 26 },
      { x: 0, y: 6, z: -26 },
    ];
    for (const impulse of directions) {
      expect(spread(collapse(impulse, 3.5))).toBeGreaterThan(STANDING_SPREAD * 0.9);
    }
  });

  it("does not let the head end up inside the pelvis", () => {
    const bones = collapse(ZERO, 3.5);
    const head = bone(bones, "head");
    const pelvis = bone(bones, "pelvis");
    const headSpec = RAGDOLL_BONES.find((b) => b.name === "head")!;
    const pelvisSpec = RAGDOLL_BONES.find((b) => b.name === "pelvis")!;

    const gap = Math.hypot(
      head.position.x - pelvis.position.x,
      head.position.y - pelvis.position.y,
      head.position.z - pelvis.position.z,
    );
    expect(gap).toBeGreaterThan(headSpec.radius + pelvisSpec.radius);
  });
});

describe("Ragdoll — the activation impulse actually lands (M6.1, found live: a full Hit knocked nobody down)", () => {
  /**
   * A ragdoll that has been sitting inactive in an already-running world —
   * which is every ragdoll in a real Match, and the one case none of the
   * tests above covered: they all activate in a world that has never
   * stepped.
   *
   * Rapier computes a body's mass properties from its colliders at the next
   * step, so a body that has lived as `Fixed` reports `mass() === 0` until
   * then. `applyImpulse` divides by that mass, so an impulse applied in the
   * same breath as `setBodyType(Dynamic)` is silently discarded — the
   * knockdown gets whatever `setLinvel` gave it and nothing else. A dash
   * into a wall still tumbled (it carries velocity of its own), which is
   * why this hid until Hit knocked down a Character standing perfectly
   * still and it just stood there.
   */
  const shoveAfterRunning = (impulse: { x: number; y: number; z: number }, seconds: number): BoneSnapshot[] => {
    const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setCollisionGroups(STATIC_GROUPS), ground);

    const ragdoll = new Ragdoll(world);
    for (let i = 0; i < 30; i += 1) world.step(); // the Match has been running a while; the bones are committed as Fixed
    ragdoll.activate({ x: 0, y: FEET_ON_FLOOR, z: 0 }, ZERO, impulse);
    for (let i = 0; i < Math.round(seconds / TICK_DT); i += 1) world.step();
    const bones = ragdoll.readBones();
    ragdoll.dispose();
    world.free();
    return bones;
  };

  it("goes down when a Hit-sized impulse lands on a ragdoll that has been idle in a running world", () => {
    // A full-charge Hit: HIT_IMPACT_MAGNITUDE + HIT_CHARGE_IMPACT_BONUS = 12,
    // along `resolveHit`'s own (toTarget + HIT_LIFT_RATIO) direction.
    const magnitude = HIT_IMPACT_MAGNITUDE + HIT_CHARGE_IMPACT_BONUS;
    const length = Math.hypot(0, HIT_LIFT_RATIO, 1);
    const bones = shoveAfterRunning(
      { x: 0, y: (HIT_LIFT_RATIO / length) * magnitude, z: (1 / length) * magnitude },
      1.5,
    );
    // Flat on the floor, not still standing where it was hit. The head starts
    // at ~1.5 units up; a Character that took the blow and never moved leaves
    // it there.
    expect(bone(bones, "head").position.y).toBeLessThan(0.5);
  });

  it("carries the impulse's own direction — it falls away from the blow, not straight down", () => {
    const pushed = shoveAfterRunning({ x: 0, y: 3.45, z: -11.49 }, 1.5);
    expect(bone(pushed, "head").position.z).toBeLessThan(-0.4);
  });
});
