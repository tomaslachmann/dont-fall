import { IDENTITY_QUAT, slerpQuat, type Quat } from "../math/quat.js";
import { addVec3, lerpVec3, vec3, type Vec3 } from "../math/vec3.js";
import { GETUP_TICKS, RAGDOLL_ELBOW_MAX, RAGDOLL_KNEE_MIN, RAGDOLL_NECK_LIMIT, RAGDOLL_SPINE_LIMIT } from "../tuning/knockdown.js";

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
   * What the bone is made of. Absent — which every bone in
   * {@link RAGDOLL_BONES} is — means `"capsule"`, as it always has been.
   *
   * Nothing in the game sets it. A body is not all one shape: a torso is
   * closer to a box, a joint closer to a ball, a limb to a capsule, and
   * having only one of those to choose from is what the demo
   * (`apps/client/src/rubber`) kept running into.
   */
  shape?: "capsule" | "box" | "hull";

  /**
   * The points a `"hull"` bone is wrapped around, in the bone's own frame.
   * Absent — which every bone in {@link RAGDOLL_BONES} is — means the bone is
   * one of the primitives above.
   *
   * Nothing in the game sets it. A convex hull is what an authored rig reaches
   * for when a body part is not honestly a box or a capsule: it takes the
   * shape the artist actually modelled rather than the nearest primitive to
   * it. Rapier builds the hull itself, so these need not be a hull already.
   */
  hullPoints?: readonly Vec3[];

  /**
   * How far a `"box"` is rounded off, 0 (sharp corners) to 1 (rounded to the
   * limit of its thinnest axis). Absent means fully rounded.
   *
   * This is what makes one shape enough. Rapier's capsule has a single
   * radius, so it is round in cross-section by definition — no depth of its
   * own, and nothing flattened can be built from one. A rounded box has three
   * independent half-extents *and* soft ends, so at equal width and depth it
   * is a capsule, flattened it is the slab a torso wants, and at roundness 0
   * it is a crate. The game's own bones stay capsules; everything authored
   * goes through here.
   */
  roundness?: number;

  /**
   * Half-thickness front to back (local Z). Read only by `"box"`, where it is
   * the third half-extent; the round shapes are as deep as they are wide.
   * Absent — which every bone in {@link RAGDOLL_BONES} is —
   * means a capsule, as it always has been.
   *
   * Setting it also changes how the other two are read: a box has no caps, so
   * `radius` and `halfHeight` become plain half-extents rather than a
   * capsule's radius and cylinder half-length.
   *
   * Nothing in the game sets it. It exists so a caller can hand
   * {@link import("./Ragdoll.js").Ragdoll} a different skeleton to try:
   * `apps/client/src/rubber` builds one with a flattened torso, to see
   * whether a body shaped like BLIP really is settles on its back rather than
   * its side. Until that is settled the game's own ragdoll is untouched.
   */
  depth?: number;

  /**
   * How the bone is turned in the rest pose. Absent — which every bone in
   * {@link RAGDOLL_BONES} is — means upright, as it always has been.
   *
   * Nothing in the game sets it. BLIP's arms and legs stick out sideways and
   * a `BoneSpec` otherwise describes a shape along its own Y, so a skeleton
   * shaped like BLIP cannot be written without this; the demo
   * (`apps/client/src/rubber`) is where that is being worked out.
   *
   * One thing to know before using it: Rapier takes a hinge's axis once and
   * reads it in *both* bodies' local frames (see {@link BoneSpec.hinge}). A
   * parent and child turned the same way still agree, so a whole limb may be
   * rotated as one; turning only half of a hinged pair would not.
   */
  restRotation?: Quat;

  /**
   * Where the collider sits relative to the body, in the bone's own frame.
   * Absent — which every bone in {@link RAGDOLL_BONES} is — means centred on
   * it, as it always has been.
   *
   * An authored ragdoll puts its bodies on the rig's own pivots and offsets
   * the shape from there, which is the only way to say "the thigh's body is
   * at the hip, and its capsule hangs below". Setting it also moves where a
   * bone joins its parent: the joint goes to this bone's own pivot rather
   * than halfway between two collider centres, because a pivot is what the
   * rig actually rotates about.
   */
  colliderOffset?: Vec3;

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
