import { describe, expect, it } from "vitest";
import { mulQuat, yawQuat, type Quat } from "../../math/quat.js";
import { rotateVec3ByQuat } from "../../math/vec3.js";
import type { BoneSnapshot } from "../ragdollSkeleton.js";
import { BLIP_RAGDOLL_SPEC } from "./blipRagdollSpec.js";
import { getUpFloorY, getUpTargetOf, matchGetUp } from "./getUp.js";

/** The baked get-up pose, placed: turned by `yaw`, its origin at (x, floorY, z). */
const placed = (side: "F" | "B", yaw: number, x = 0, z = 0, floorY = 0): BoneSnapshot[] => {
  const facing = yawQuat(yaw);
  return BLIP_RAGDOLL_SPEC.getUp[side].bones.map((bone) => {
    const turned = rotateVec3ByQuat(bone.position, facing);
    return {
      position: { x: turned.x + x, y: turned.y + floorY, z: turned.z + z },
      rotation: mulQuat(facing, bone.rotation),
    };
  });
};

const angleBetween = (a: Quat, b: Quat): number => {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, dot));
};

describe("matchGetUp (.scratch/physical-ragdoll ticket 03)", () => {
  it("tells a body lying on its back from one lying on its face", () => {
    expect(matchGetUp(placed("B", 0))?.side).toBe("B");
    expect(matchGetUp(placed("F", 0))?.side).toBe("F");
  });

  /**
   * The property the whole handover rests on: the simulation sweeps the heap
   * onto the pose this match names, and the client then reads the match back
   * off those same swept bones to place the clip. If the rule were not fixed
   * under its own output, the clip would be drawn somewhere other than where
   * the bones were left — which is the seam the physical get-up exists to
   * close.
   */
  it("reads its own output back exactly — the placed clip pose matches to where it was placed", () => {
    for (const side of ["F", "B"] as const) {
      for (const yaw of [0, 0.7, -2.4, Math.PI - 0.01]) {
        const match = matchGetUp(placed(side, yaw, 3, -2));
        expect(match, `${side} at ${yaw}`).not.toBeNull();
        expect(match!.side).toBe(side);
        expect(Math.atan2(Math.sin(match!.yaw - yaw), Math.cos(match!.yaw - yaw))).toBeCloseTo(0, 4);
        expect(match!.originX).toBeCloseTo(3, 4);
        expect(match!.originZ).toBeCloseTo(-2, 4);
      }
    }
  });

  it("puts the clip's own origin where the body lies, not where the pelvis is", () => {
    // The clip's first frame carries the pelvis a third of a unit out from
    // the origin (ADR 0076's measurement); playing it from the pelvis would
    // shift the whole body sideways at the handover.
    const match = matchGetUp(placed("B", 0, 0, 0))!;
    const pelvis = placed("B", 0, 0, 0)[0]!.position;
    expect(Math.hypot(pelvis.x - match.originX, pelvis.z - match.originZ)).toBeGreaterThan(0.3);
  });

  it("has nothing to say about a body with no bones", () => {
    expect(matchGetUp([])).toBeNull();
  });

  it("targets every bone of the placed pose, bone for bone", () => {
    const yaw = 1.3;
    const pose = placed("F", yaw, -1, 4, 2.5);
    const match = matchGetUp(pose)!;
    const floorY = getUpFloorY(pose, match);
    for (const [i, bone] of pose.entries()) {
      const target = getUpTargetOf(match, i, floorY)!;
      expect(target.position.x).toBeCloseTo(bone.position.x, 4);
      expect(target.position.y).toBeCloseTo(bone.position.y, 4);
      expect(target.position.z).toBeCloseTo(bone.position.z, 4);
      expect(angleBetween(target.rotation, bone.rotation)).toBeLessThan(0.01);
    }
  });

  it("plays the clip on the floor the heap came to rest on", () => {
    const pose = placed("B", 0, 0, 0, 7.25);
    expect(getUpFloorY(pose, matchGetUp(pose)!)).toBeCloseTo(7.25, 4);
  });
});
