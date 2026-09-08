import { IDENTITY_QUAT, slerpQuat, type Quat } from "../math/quat.js";
import { addVec3, lerpVec3, vec3, type Vec3 } from "../math/vec3.js";
import {
  GETUP_TICKS,
  RAGDOLL_ELBOW_MAX,
  RAGDOLL_KNEE_MIN,
  RAGDOLL_NECK_LIMIT,
  RAGDOLL_SPINE_LIMIT,
} from "../tuning.js";

/** One bone's world transform, for the snapshot / renderer. Ordered as {@link RAGDOLL_BONES}. */
export interface BoneSnapshot {
  position: Vec3;
  rotation: Quat;
}

/**
 * One bone of the Character's articulated ragdoll (ADR 0006, ticket 05). Offsets
 * are relative to the Character root (the kinematic capsule's centre) in the
 * standing rest pose. Both the simulation (to build Rapier bodies + joints) and
 * the renderer (to build meshes) read this spec, so it is the single source of
 * the skeleton's shape.
 */
export interface BoneSpec {
  name: string;
  /** Parent bone name, or `null` for the root (pelvis). Each non-root bone gets a
   *  spherical joint to its parent, anchored at the midpoint between the two. */
  parent: string | null;
  /** Bone centre in the standing rest pose, relative to the Character root. */
  restCenter: Vec3;
  /** Half-length of the bone's capsule along its local Y axis (excludes the caps). */
  halfHeight: number;
  radius: number;
  mass: number;
  /**
   * How this bone hangs off its parent (M6 ticket 05, ADR 0047). A hinge:
   * one axis and how far it may swing either way.
   *
   * Rapier takes the axis once and reads it in *both* bodies' local frames,
   * which is only the same direction because `Ragdoll.activate` starts every
   * bone at the identity rotation. A bone given a non-identity rest
   * orientation would need the axis expressed per-body instead.
   *
   * Absent means a free ball joint, which is what every bone had before this
   * — kept for the shoulders and hips, where a cone limit is what you'd
   * actually want and Rapier 0.20's `SphericalImpulseJoint` has no
   * `setLimits` to express one. A deliberate remainder, not an oversight:
   * limbs that swing freely from the torso still read fine, where an elbow
   * that bends both ways does not.
   */
  hinge?: { axis: Vec3; min: number; max: number };
}

/** A hinge swinging around the body's own left-right axis — every joint that needs one bends this way. */
const sideways = (min: number, max: number): NonNullable<BoneSpec["hinge"]> => ({ axis: vec3(1, 0, 0), min, max });

export const RAGDOLL_BONES: readonly BoneSpec[] = [
  { name: "pelvis", parent: null, restCenter: vec3(0, -0.15, 0), halfHeight: 0.1, radius: 0.16, mass: 3 },
  { name: "chest", parent: "pelvis", restCenter: vec3(0, 0.24, 0), halfHeight: 0.14, radius: 0.18, mass: 4, hinge: sideways(-RAGDOLL_SPINE_LIMIT, RAGDOLL_SPINE_LIMIT) },
  { name: "head", parent: "chest", restCenter: vec3(0, 0.6, 0), halfHeight: 0.05, radius: 0.13, mass: 1.4, hinge: sideways(-RAGDOLL_NECK_LIMIT, RAGDOLL_NECK_LIMIT) },

  { name: "upperArmL", parent: "chest", restCenter: vec3(0.3, 0.3, 0), halfHeight: 0.12, radius: 0.055, mass: 0.7 },
  { name: "lowerArmL", parent: "upperArmL", restCenter: vec3(0.3, 0.02, 0), halfHeight: 0.12, radius: 0.05, mass: 0.6, hinge: sideways(0, RAGDOLL_ELBOW_MAX) },
  { name: "upperArmR", parent: "chest", restCenter: vec3(-0.3, 0.3, 0), halfHeight: 0.12, radius: 0.055, mass: 0.7 },
  { name: "lowerArmR", parent: "upperArmR", restCenter: vec3(-0.3, 0.02, 0), halfHeight: 0.12, radius: 0.05, mass: 0.6, hinge: sideways(0, RAGDOLL_ELBOW_MAX) },

  { name: "upperLegL", parent: "pelvis", restCenter: vec3(0.11, -0.42, 0), halfHeight: 0.15, radius: 0.08, mass: 1.6 },
  { name: "lowerLegL", parent: "upperLegL", restCenter: vec3(0.11, -0.73, 0), halfHeight: 0.15, radius: 0.06, mass: 1.2, hinge: sideways(RAGDOLL_KNEE_MIN, 0) },
  { name: "upperLegR", parent: "pelvis", restCenter: vec3(-0.11, -0.42, 0), halfHeight: 0.15, radius: 0.08, mass: 1.6 },
  { name: "lowerLegR", parent: "upperLegR", restCenter: vec3(-0.11, -0.73, 0), halfHeight: 0.15, radius: 0.06, mass: 1.2, hinge: sideways(RAGDOLL_KNEE_MIN, 0) },
] as const;

/** Midpoint of the joint connecting `bone` to its parent, relative to the Character root. */
export const jointRestPoint = (bone: BoneSpec, parent: BoneSpec): Vec3 => ({
  x: (bone.restCenter.x + parent.restCenter.x) / 2,
  y: (bone.restCenter.y + parent.restCenter.y) / 2,
  z: (bone.restCenter.z + parent.restCenter.z) / 2,
});

/**
 * Blend the pose captured when GettingUp began (`from`) toward the standing rest
 * pose around `capsuleCentre`, by `elapsedTicks` of {@link GETUP_TICKS}. Pure —
 * both the client and (in M2) the server compute the authoritative getup poses
 * this way.
 */
export const blendGettingUpBones = (
  from: readonly BoneSnapshot[],
  capsuleCentre: Vec3,
  elapsedTicks: number,
): BoneSnapshot[] => {
  const t = Math.min(1, Math.max(0, elapsedTicks / GETUP_TICKS));
  return RAGDOLL_BONES.map((spec, i) => {
    const rest: BoneSnapshot = {
      position: addVec3(capsuleCentre, spec.restCenter),
      rotation: IDENTITY_QUAT,
    };
    const start = from[i] ?? rest;
    return {
      position: lerpVec3(start.position, rest.position, t),
      rotation: slerpQuat(start.rotation, rest.rotation, t),
    };
  });
};
