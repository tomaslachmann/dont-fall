import { vec3, type Vec3 } from "../math/vec3.js";

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
}

export const RAGDOLL_BONES: readonly BoneSpec[] = [
  { name: "pelvis", parent: null, restCenter: vec3(0, -0.15, 0), halfHeight: 0.1, radius: 0.16, mass: 3 },
  { name: "chest", parent: "pelvis", restCenter: vec3(0, 0.24, 0), halfHeight: 0.14, radius: 0.18, mass: 4 },
  { name: "head", parent: "chest", restCenter: vec3(0, 0.6, 0), halfHeight: 0.05, radius: 0.13, mass: 1.4 },

  { name: "upperArmL", parent: "chest", restCenter: vec3(0.3, 0.3, 0), halfHeight: 0.12, radius: 0.055, mass: 0.7 },
  { name: "lowerArmL", parent: "upperArmL", restCenter: vec3(0.3, 0.02, 0), halfHeight: 0.12, radius: 0.05, mass: 0.6 },
  { name: "upperArmR", parent: "chest", restCenter: vec3(-0.3, 0.3, 0), halfHeight: 0.12, radius: 0.055, mass: 0.7 },
  { name: "lowerArmR", parent: "upperArmR", restCenter: vec3(-0.3, 0.02, 0), halfHeight: 0.12, radius: 0.05, mass: 0.6 },

  { name: "upperLegL", parent: "pelvis", restCenter: vec3(0.11, -0.42, 0), halfHeight: 0.15, radius: 0.08, mass: 1.6 },
  { name: "lowerLegL", parent: "upperLegL", restCenter: vec3(0.11, -0.73, 0), halfHeight: 0.15, radius: 0.06, mass: 1.2 },
  { name: "upperLegR", parent: "pelvis", restCenter: vec3(-0.11, -0.42, 0), halfHeight: 0.15, radius: 0.08, mass: 1.6 },
  { name: "lowerLegR", parent: "upperLegR", restCenter: vec3(-0.11, -0.73, 0), halfHeight: 0.15, radius: 0.06, mass: 1.2 },
] as const;

/** Midpoint of the joint connecting `bone` to its parent, relative to the Character root. */
export const jointRestPoint = (bone: BoneSpec, parent: BoneSpec): Vec3 => ({
  x: (bone.restCenter.x + parent.restCenter.x) / 2,
  y: (bone.restCenter.y + parent.restCenter.y) / 2,
  z: (bone.restCenter.z + parent.restCenter.z) / 2,
});
