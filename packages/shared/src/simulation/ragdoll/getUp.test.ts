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

  /**
   * The test's own seating rule: the lowest hull contact of `bones`
   * (independent of `getUpFloorY` — it is what seats the fixture, not what
   * is under test).
   */
  const contactsRestOn = (bones: BoneSnapshot[]): number => {
    let min = Infinity;
    for (const [i, bone] of bones.entries()) {
      for (const p of BLIP_RAGDOLL_SPEC.bones[i]!.hull) {
        const w = rotateVec3ByQuat(p, bone.rotation);
        min = Math.min(min, bone.position.y + w.y);
      }
    }
    return min;
  };

  it("seats the clip's contacts on the heap's contacts — pivots lie (sunk capsule, found live 2026-09-20)", () => {
    // A real heap never shares the clip's relative pose: its pivots float
    // lower over the deck than the clip's float over its origin (0.05–0.17
    // vs 0.21–0.41), so aligning pivots seats the capsule decimetres under
    // the deck. Pitch every bone 90° in place so pivots and contacts no
    // longer stand in the clip's own relation, then seat the CONTACTS on
    // the floor: the clip must still play on that floor.
    const pitch: Quat = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const heap = placed("B", 0.7, 3, -2, 0).map((bone) => ({
      position: bone.position,
      rotation: mulQuat(pitch, bone.rotation),
    }));
    const lift = 7.25 - contactsRestOn(heap);
    const seated = heap.map((bone) => ({ ...bone, position: { ...bone.position, y: bone.position.y + lift } }));
    // The invariant, not the number: the clip placed at the returned floor
    // rests its own contacts where the heap's are (the hulls reach ~3 cm
    // below the rig origin, so the origin itself floats that far — a float
    // gravity heals in the first GettingUp ticks, where the old pivot rule's
    // decimetre sink never healed at all).
    const match = matchGetUp(seated)!;
    const floorY = getUpFloorY(seated, match);
    const clip = seated.map((_, i) => getUpTargetOf(match, i, floorY)!);
    expect(contactsRestOn(clip)).toBeCloseTo(7.25, 4);
  });
});
