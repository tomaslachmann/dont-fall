import { describe, expect, it } from "vitest";
import { yawQuat } from "./quat.js";
import { rotateYaw } from "./vec3.js";

const closeVec = (v: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }): void => {
  expect(v.x).toBeCloseTo(expected.x, 10);
  expect(v.y).toBeCloseTo(expected.y, 10);
  expect(v.z).toBeCloseTo(expected.z, 10);
};

/** Rotates `v` by quaternion `q` via the standard `v + 2w(u×v) + 2(u×(u×v))` formula — an independent reference to check `rotateYaw` against, not the implementation under test. */
const rotateByQuat = (v: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }) => {
  const u = { x: q.x, y: q.y, z: q.z };
  const cross = (a: typeof u, b: typeof u) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return {
    x: v.x + 2 * q.w * uv.x + 2 * uuv.x,
    y: v.y + 2 * q.w * uv.y + 2 * uuv.y,
    z: v.z + 2 * q.w * uv.z + 2 * uuv.z,
  };
};

describe("rotateYaw", () => {
  it("is the identity at yaw 0", () => {
    closeVec(rotateYaw({ x: 1, y: 2, z: 3 }, 0), { x: 1, y: 2, z: 3 });
  });

  it("never touches y", () => {
    expect(rotateYaw({ x: 1, y: 42, z: 1 }, Math.PI / 3).y).toBe(42);
  });

  it("rotating by PI is a 180° turn in the XZ plane", () => {
    closeVec(rotateYaw({ x: 1, y: 0, z: 2 }, Math.PI), { x: -1, y: 0, z: -2 });
  });

  it("matches Rapier's yawQuat rotation exactly — the convention that actually rotates Spinners and Three.js meshes, not movementDirection's mirrored one (code-review finding)", () => {
    for (const yaw of [0.3, 1.2, Math.PI / 2, -Math.PI / 2, 2.1, -1.7]) {
      for (const v of [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 2.5, y: 7, z: -3.1 },
      ]) {
        closeVec(rotateYaw(v, yaw), rotateByQuat(v, yawQuat(yaw)));
      }
    }
  });
});
