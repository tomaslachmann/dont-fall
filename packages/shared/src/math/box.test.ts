import { describe, expect, it } from "vitest";
import { eulerQuat, IDENTITY_QUAT, mulQuat, pitchQuat, rollQuat, yawQuat } from "./quat.js";
import type { Vec3 } from "./vec3.js";
import { inflateBox, obbsOverlap, orientBox, pointInBox, pointInOrientedBox, type Box, type OrientedBox } from "./box.js";

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

describe("pointInOrientedBox (ADR 0034 code review — a rotated Checkpoint trigger must still detect containment correctly, at any angle, not just an axis-aligned approximation)", () => {
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

describe("inflateBox (ticket 04 — a Footprint's clearance grows its box before overlap-checking)", () => {
  it("adds the amount to every half-extent, leaving centre/rotation untouched", () => {
    const b: OrientedBox = { center: { x: 1, y: 2, z: 3 }, halfExtents: { x: 1, y: 2, z: 3 }, rotation: yawQuat(0.4) };
    const inflated = inflateBox(b, 0.5);
    expect(inflated.halfExtents).toEqual({ x: 1.5, y: 2.5, z: 3.5 });
    expect(inflated.center).toEqual(b.center);
    expect(inflated.rotation).toEqual(b.rotation);
  });

  it("a zero amount is a no-op", () => {
    const b: OrientedBox = { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } };
    expect(inflateBox(b, 0)).toEqual(b);
  });
});

describe("obbsOverlap (ticket 04 — the live overlap-feedback primitive, SAT for two oriented boxes)", () => {
  const unitBox = (center: Vec3, rotation = IDENTITY_QUAT): OrientedBox => ({
    center,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    rotation,
  });

  it("two identical, coincident boxes overlap", () => {
    const a = unitBox({ x: 0, y: 0, z: 0 });
    expect(obbsOverlap(a, a)).toBe(true);
  });

  it("two axis-aligned boxes exactly touching (surfaces flush) count as overlapping — inclusive, like pointInBox", () => {
    const a = unitBox({ x: 0, y: 0, z: 0 });
    const b = unitBox({ x: 1, y: 0, z: 0 }); // surfaces meet exactly at x=0.5
    expect(obbsOverlap(a, b)).toBe(true);
    expect(obbsOverlap(b, a)).toBe(true); // symmetric
  });

  it("pulling the same two boxes apart by a hair separates them", () => {
    const a = unitBox({ x: 0, y: 0, z: 0 });
    const b = unitBox({ x: 1.001, y: 0, z: 0 });
    expect(obbsOverlap(a, b)).toBe(false);
  });

  it("overlapping on two axes but clearly separated on the third does not overlap", () => {
    const a = unitBox({ x: 0, y: 0, z: 0 });
    const b = unitBox({ x: 0, y: 5, z: 0 }); // same X/Z, far apart on Y
    expect(obbsOverlap(a, b)).toBe(false);
  });

  it("is unaffected by rotation when the boxes are far enough apart to never touch regardless of orientation", () => {
    // Bounding-sphere argument: a unit box's furthest possible reach from its
    // centre, at any rotation, is length({0.5,0.5,0.5}) ≈ 0.866. Two such
    // boxes 3 units apart can never overlap no matter how either is rotated
    // — a rotation-robust "definitely false" case that doesn't require
    // hand-verifying the SAT axes for a specific angle.
    const a = unitBox({ x: 0, y: 0, z: 0 }, eulerQuat(0.3, 0.7, 1.1));
    const b = unitBox({ x: 3, y: 0, z: 0 }, mulQuat(pitchQuat(0.5), rollQuat(0.9)));
    expect(obbsOverlap(a, b)).toBe(false);
    expect(obbsOverlap(b, a)).toBe(false);
  });

  it("overlaps whenever one box's corner coincides with another's centre, at an arbitrary rotation", () => {
    // `a` unrotated, so its corner is trivial to compute (center ±
    // halfExtents, no rotation math to get wrong). `b` is centred exactly on
    // that corner — a box's own centre is always inside it, at *any*
    // rotation (the same fact `pointInOrientedBox`'s own tests rely on) — so
    // this is a solid "definitely overlapping" case without needing to
    // hand-derive the 15-axis SAT test for a specific rotated configuration.
    const a: OrientedBox = { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } };
    const cornerWorld = { x: 1, y: 1, z: 1 };
    const b: OrientedBox = { center: cornerWorld, halfExtents: { x: 2, y: 2, z: 2 }, rotation: eulerQuat(0.3, 0.5, 0.7) };
    expect(pointInOrientedBox(cornerWorld, b)).toBe(true); // sanity: b's own centre is always inside it
    expect(obbsOverlap(a, b)).toBe(true);
    expect(obbsOverlap(b, a)).toBe(true);
  });

  it("is symmetric for a variety of configurations", () => {
    const configs: [OrientedBox, OrientedBox][] = [
      [unitBox({ x: 0, y: 0, z: 0 }), unitBox({ x: 0.7, y: 0.3, z: 0 }, yawQuat(0.5))],
      [unitBox({ x: 0, y: 0, z: 0 }, eulerQuat(0.1, 0.2, 0.3)), unitBox({ x: 2, y: 0, z: 0 }, eulerQuat(0.4, 0.1, 0.2))],
      [unitBox({ x: 0, y: 0, z: 0 }), unitBox({ x: 10, y: 10, z: 10 })],
    ];
    for (const [a, b] of configs) {
      expect(obbsOverlap(a, b)).toBe(obbsOverlap(b, a));
    }
  });
});
