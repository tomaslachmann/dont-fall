import { describe, expect, it } from "vitest";
import { rotateYaw } from "./vec3.js";

const closeVec = (v: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }): void => {
  expect(v.x).toBeCloseTo(expected.x, 10);
  expect(v.y).toBeCloseTo(expected.y, 10);
  expect(v.z).toBeCloseTo(expected.z, 10);
};

describe("rotateYaw", () => {
  it("is the identity at yaw 0", () => {
    closeVec(rotateYaw({ x: 1, y: 2, z: 3 }, 0), { x: 1, y: 2, z: 3 });
  });

  it("matches movementDirection's forward(yaw) = (sin, 0, -cos) convention", () => {
    // Local "forward" is (0, 0, -1) — rotating it by yaw must equal forward(yaw).
    const yaw = 0.7;
    closeVec(rotateYaw({ x: 0, y: 0, z: -1 }, yaw), { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
  });

  it("matches movementDirection's right(yaw) = (cos, 0, sin) convention", () => {
    const yaw = 1.1;
    closeVec(rotateYaw({ x: 1, y: 0, z: 0 }, yaw), { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) });
  });

  it("never touches y", () => {
    expect(rotateYaw({ x: 1, y: 42, z: 1 }, Math.PI / 3).y).toBe(42);
  });

  it("rotating by PI is a 180° turn in the XZ plane", () => {
    closeVec(rotateYaw({ x: 1, y: 0, z: 2 }, Math.PI), { x: -1, y: 0, z: -2 });
  });
});
