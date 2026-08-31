import { describe, expect, it } from "vitest";
import { pointInBox, type Box } from "./box.js";

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
