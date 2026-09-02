import { describe, expect, it } from "vitest";
import { eulerQuat, IDENTITY_QUAT, yawQuat } from "./quat.js";
import { orientBox, pointInBox, pointInOrientedBox, type Box, type OrientedBox } from "./box.js";

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

describe("pointInOrientedBox (ADR 0034 code review — a rotated Checkpoint volume must still detect containment correctly, at any angle, not just an axis-aligned approximation)", () => {
  it("agrees with pointInBox when there's no rotation", () => {
    const b: OrientedBox = { ...box };
    expect(pointInOrientedBox({ x: 0, y: 1, z: 0 }, b)).toBe(true);
    expect(pointInOrientedBox({ x: 2.01, y: 1, z: 0 }, b)).toBe(false);
  });

  it("a point that would be outside the un-rotated box is inside once the box is rotated to meet it", () => {
    // An oblong box, long on X (halfExtents.x=4, halfExtents.z=1). At (0,0,3)
    // it would be outside (z=3 > halfExtents.z=1) — but rotate the box 90°
    // around Y and its long axis now points along Z, so (0,0,3) is inside.
    const oblong: OrientedBox = { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 4, y: 1, z: 1 } };
    expect(pointInOrientedBox({ x: 0, y: 0, z: 3 }, oblong)).toBe(false);
    const rotated: OrientedBox = { ...oblong, rotation: yawQuat(Math.PI / 2) };
    expect(pointInOrientedBox({ x: 0, y: 0, z: 3 }, rotated)).toBe(true);
  });

  it("respects an off-origin, rotated centre", () => {
    const b: OrientedBox = { center: { x: 10, y: 0, z: -5 }, halfExtents: { x: 4, y: 1, z: 1 }, rotation: yawQuat(Math.PI / 2) };
    // Long axis (X, half-extent 4) now points along world Z after the 90° yaw.
    expect(pointInOrientedBox({ x: 10, y: 0, z: -8 }, b)).toBe(true);
    expect(pointInOrientedBox({ x: 13, y: 0, z: -5 }, b)).toBe(false);
  });

  it("works at an arbitrary (non-90°) angle too, not just multiples of 90°", () => {
    const tilted: OrientedBox = { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 }, rotation: eulerQuat(0.4, 0, 0) };
    // The box's own centre is always inside, at any rotation.
    expect(pointInOrientedBox({ x: 0, y: 0, z: 0 }, tilted)).toBe(true);
  });
});

describe("orientBox (ADR 0034 — replaces rotateBoxYaw90's AABB-only placement)", () => {
  const oblong: Box = { center: { x: 2, y: 1, z: 3 }, halfExtents: { x: 4, y: 0.5, z: 1 } };

  it("at identity rotation and zero translation, is a no-op", () => {
    const placed = orientBox(oblong, { x: 0, y: 0, z: 0 }, IDENTITY_QUAT);
    expect(placed).toEqual({ ...oblong, rotation: IDENTITY_QUAT });
  });

  it("translates the centre by the given offset", () => {
    const placed = orientBox(oblong, { x: 10, y: -5, z: 1 }, IDENTITY_QUAT);
    expect(placed.center).toEqual({ x: 12, y: -4, z: 4 });
  });

  it("rotates the centre but never touches halfExtents — no more axis-swap trick", () => {
    const placed = orientBox(oblong, { x: 0, y: 0, z: 0 }, yawQuat(Math.PI / 2));
    // halfExtents stay exactly as authored — Rapier's own setRotation()
    // handles the actual collider orientation now.
    expect(placed.halfExtents).toEqual(oblong.halfExtents);
    expect(placed.center.x).toBeCloseTo(3, 10);
    expect(placed.center.z).toBeCloseTo(-2, 10);
  });

  it("carries the rotation through unchanged, for the caller (RapierSimulation) to apply directly", () => {
    const rotation = eulerQuat(0.3, 0.4, 0.5);
    const placed = orientBox(oblong, { x: 0, y: 0, z: 0 }, rotation);
    expect(placed.rotation).toEqual(rotation);
  });

  it("accepts any rotation, not just a multiple of 90° — the whole point of ADR 0034", () => {
    expect(() => orientBox(oblong, { x: 0, y: 0, z: 0 }, eulerQuat(0.1, 0.2, 0.3))).not.toThrow();
  });
});
