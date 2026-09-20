import { rotateVec3ByQuat, type Vec3 } from "../../math/vec3.js";
import { mulQuat, yawQuat, type Quat } from "../../math/quat.js";
import type { BoneSnapshot } from "../ragdollSkeleton.js";
import { BLIP_RAGDOLL_SPEC } from "./blipRagdollSpec.js";
import type { BlipRagdollSpec } from "./spec.js";

/**
 * Where a settled heap gets up (`.scratch/physical-ragdoll` ticket 03): which
 * `GetUp_X` clip matches how the body lies, turned and pinned so the clip's
 * own first frame starts exactly over the heap. The knockout's last stretch
 * sweeps the bones onto that placed pose; the client derives the same match
 * from the same replicated bones to place the clip — one rule, two readers,
 * no new wire field.
 */
export interface GetUpMatch {
  /** Which get-up reads best: `F` face-down, `B` face-up. */
  side: "F" | "B";
  /** The three.js yaw the clip's pose is turned by (the drawn rig's yaw at the get-up). */
  yaw: number;
  /** Where the clip's own origin (the rig origin, ADR 0076) lands, horizontally. */
  originX: number;
  originZ: number;
}

/**
 * Matches a heap to its get-up. F/B only: with the free yaw a body lies
 * belly-up or belly-down, so the four diagonal clips stay unused. No guess
 * about the clip's own lying convention either — the baked pose is turned so
 * ITS head lies where the heap's head lies, and pinned so its pelvis sits
 * over the heap's (the bench's rule, verbatim).
 */
export const matchGetUp = (
  bones: readonly BoneSnapshot[],
  spec: BlipRagdollSpec = BLIP_RAGDOLL_SPEC,
): GetUpMatch | null => {
  const pelvisAt = spec.bones.findIndex((b) => b.bone === "pelvis");
  const chestAt = spec.bones.findIndex((b) => b.bone === "body");
  const headAt = spec.bones.findIndex((b) => b.bone === "head");
  const pelvis = bones[pelvisAt];
  const chest = bones[chestAt];
  if (!pelvis || !chest) return null;

  const belly = rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, chest.rotation);
  const spine = rotateVec3ByQuat({ x: 0, y: 1, z: 0 }, chest.rotation);
  const side = belly.y < 0 ? "F" : "B";
  const pose = spec.getUp[side];
  const clipPelvis = pose.bones[pelvisAt]!.position;
  const clipHead = pose.bones[headAt]!.position;
  const yaw =
    Math.atan2(spine.x, spine.z) - Math.atan2(clipHead.x - clipPelvis.x, clipHead.z - clipPelvis.z);
  const atYaw = rotateVec3ByQuat(clipPelvis, yawQuat(yaw));
  return { side, yaw, originX: pelvis.position.x - atYaw.x, originZ: pelvis.position.z - atYaw.z };
};

/**
 * The floor the clip should be played on, read off the heap itself: both
 * poses are a body resting on the ground, so putting the clip's lowest bone
 * where the heap's lowest bone is puts the clip on the same floor. Asking the
 * world instead would need a ray the simulation has no reason to cast, and
 * would disagree with the body whenever it came to rest on a Prop.
 */
export const getUpFloorY = (
  bones: readonly BoneSnapshot[],
  match: GetUpMatch,
  spec: BlipRagdollSpec = BLIP_RAGDOLL_SPEC,
): number => {
  const heapLowest = Math.min(...bones.map((b) => b.position.y));
  const clipLowest = Math.min(...spec.getUp[match.side].bones.map((b) => b.position.y));
  return heapLowest - clipLowest;
};

/** The placed sweep target for one bone of `match`: the baked pose turned and pinned, on a floor at `floorY`. */
export const getUpTargetOf = (
  match: GetUpMatch,
  boneIndex: number,
  floorY: number,
  spec: BlipRagdollSpec = BLIP_RAGDOLL_SPEC,
): { position: Vec3; rotation: Quat } | null => {
  const bone = spec.getUp[match.side].bones[boneIndex];
  if (!bone) return null;
  const facing = yawQuat(match.yaw);
  const turned = rotateVec3ByQuat(bone.position, facing);
  return {
    position: { x: turned.x + match.originX, y: turned.y + floorY, z: turned.z + match.originZ },
    rotation: mulQuat(facing, bone.rotation),
  };
};
