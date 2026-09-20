import type { Quat } from "../../math/quat.js";
import type { Vec3 } from "../../math/vec3.js";

/**
 * The baked description of BLIP's authored ragdoll (`.scratch/physical-ragdoll`,
 * ticket 01): everything `AuthoredRagdoll` needs, pre-resolved to literal data
 * by `pnpm bake:ragdoll` so the simulation does no frame math of its own. The
 * recipe the bake runs — per-body hinge axes, rest-shifted limits, rope-stop
 * swing cones and twist budgets, the zero-g rest-overlap probe — was proven in
 * the rubber bench (2026-09-20) and lives with the bake page, where three.js
 * is at hand.
 *
 * Everything is in SIM units. Bone rest transforms are relative to the
 * Character root (the kinematic capsule's centre), facing +Z, exactly as
 * `ragdollSkeleton.ts` measures the old skeleton. Hull points and joint
 * anchors are in each body's own frame. The get-up poses are relative to the
 * rig origin — the point on the floor under the Character, facing +Z — which
 * is how the clips themselves are placed (ADR 0076).
 */

export interface BakedTransform {
  position: Vec3;
  rotation: Quat;
}

export interface BakedBone {
  /** The GLB bone this body sits on (dots kept — `upper_arm.L`); doubles as the wire-order name. */
  bone: string;
  /** Rest transform relative to the capsule centre, facing +Z. */
  rest: BakedTransform;
  /** Convex hull points in the bone's own frame — what the artist modelled, quantized to a budget. */
  hull: Vec3[];
  mass: number;
  angularDamping: number;
}

interface BakedJointBase {
  /** Bone names, parent (`a`) and child (`b`). */
  a: string;
  b: string;
  /** Joint anchors in each body's own frame. */
  anchorA: Vec3;
  anchorB: Vec3;
}

/** A free ball joint — its cone and twist stops are the `rope` entries baked beside it. */
export interface BakedSphericalJoint extends BakedJointBase {
  type: "spherical";
}

/**
 * A hinge. The axis is expressed per body — Rapier reads a single-axis
 * revolute in BOTH local frames, which is only the same hinge when both
 * bodies rest at identity — and the limits (and motor target, when a joint
 * has tone of its own) are already shifted by the hinge's own rest angle, so
 * they can be applied as written.
 */
export interface BakedRevoluteJoint extends BakedJointBase {
  type: "revolute";
  axisA: Vec3;
  axisB: Vec3;
  limits: [number, number];
  motor?: { target: number; stiffness: number; damping: number };
}

/**
 * A hard stop for a ball joint, as a rope: both anchors coincide at rest
 * (length 0 — it can never kick at spawn) and the rope goes taut at `length`.
 * A point on the child's bone axis caps swing alone; a point off the axis
 * moves under any rotation, so its rope caps swing + a twist budget.
 */
export interface BakedRopeJoint extends BakedJointBase {
  type: "rope";
  length: number;
}

export type BakedJoint = BakedSphericalJoint | BakedRevoluteJoint | BakedRopeJoint;

/** One get-up clip's first frame: per bone, wire order, rig-origin frame. */
export interface BakedGetUpPose {
  bones: BakedTransform[];
}

export interface BlipRagdollSpec {
  /** Wire order (ADR 0018–0025: the snapshot's `bones` array is this order), parent before child. */
  bones: BakedBone[];
  joints: BakedJoint[];
  /**
   * Pairs the artist modelled interpenetrating at rest (the head hull over
   * both shoulders). The solver could only push them apart by deforming the
   * rest pose, so a contact between them injects energy — measured throwing
   * the arms at 13.6 u/s with nobody touching the doll. Their contacts are
   * disabled outright; everything that stands clear at rest still
   * self-collides (ADR 0047).
   */
  restTouching: [string, string][];
  /** `GetUp_F` / `GetUp_B` frame 0 — what the pose-matched get-up sweeps onto (ticket 03). */
  getUp: { F: BakedGetUpPose; B: BakedGetUpPose };
  /** How the bake ran, for reading the numbers later. */
  bake: { model: string; colliders: string; scale: number; drop: number };
}
