import { describe, expect, it } from "vitest";
import { pointInBox, rotateBoxYaw90, type Box } from "./box.js";

const box: Box = { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 2, y: 1.5, z: 2 } };

describe("pointInBox", () => {
  it("is true for a point at the centre", () => {
    expect(pointInBox({ x: 0, y: 1, z: 0 }, box)).toBe(true);
  });

  it("is true for a point on the surface", () => {
    expect(pointInBox({ x: 2, y: 1, z: 0 }, box)).toBe(true);
  });

  it("is false just outside any axis", () => {
    expect(pointInBox({ x: 2.01, y: 1, z: 0 }, box)).toBe(false);
    expect(pointInBox({ x: 0, y: 2.51, z: 0 }, box)).toBe(false);
    expect(pointInBox({ x: 0, y: 1, z: -2.01 }, box)).toBe(false);
  });

  it("respects an off-origin centre", () => {
    const shifted: Box = { center: { x: 10, y: 0, z: -5 }, halfExtents: { x: 1, y: 1, z: 1 } };
    expect(pointInBox({ x: 10.5, y: 0.5, z: -4.5 }, shifted)).toBe(true);
    expect(pointInBox({ x: 8, y: 0, z: -5 }, shifted)).toBe(false);
  });
});

describe("rotateBoxYaw90", () => {
  const oblong: Box = { center: { x: 2, y: 1, z: 3 }, halfExtents: { x: 4, y: 0.5, z: 1 } };

  it("is the identity at yaw 0", () => {
    expect(rotateBoxYaw90(oblong, 0)).toEqual(oblong);
  });

  it("swaps X/Z half-extents at 90°, and rotates the centre", () => {
    const rotated = rotateBoxYaw90(oblong, Math.PI / 2);
    expect(rotated.halfExtents).toEqual({ x: 1, y: 0.5, z: 4 });
    expect(rotated.center.x).toBeCloseTo(3, 10);
    expect(rotated.center.z).toBeCloseTo(-2, 10);
  });

  it("swaps X/Z half-extents at 270° too", () => {
    expect(rotateBoxYaw90(oblong, (3 * Math.PI) / 2).halfExtents).toEqual({ x: 1, y: 0.5, z: 4 });
  });

  it("keeps X/Z half-extents unswapped at 180° (shape unchanged, only centre flips)", () => {
    const rotated = rotateBoxYaw90(oblong, Math.PI);
    expect(rotated.halfExtents).toEqual(oblong.halfExtents);
    expect(rotated.center.x).toBeCloseTo(-2, 10);
    expect(rotated.center.z).toBeCloseTo(-3, 10);
  });

  it("throws for a yaw that isn't a multiple of 90° — would desync from the collider", () => {
    expect(() => rotateBoxYaw90(oblong, Math.PI / 4)).toThrow(/multiple of 90/);
  });
});
