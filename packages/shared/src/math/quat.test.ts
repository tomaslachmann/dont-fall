import { describe, expect, it } from "vitest";
import { conjugateQuat, dotQuat, IDENTITY_QUAT, mulQuat, yawQuat } from "./quat.js";

describe("quat", () => {
  it("mulQuat composes rotations — yaw(a) ∘ yaw(b) = yaw(a + b)", () => {
    const combined = mulQuat(yawQuat(0.3), yawQuat(0.4));
    const expected = yawQuat(0.7);
    expect(combined.x).toBeCloseTo(expected.x, 6);
    expect(combined.y).toBeCloseTo(expected.y, 6);
    expect(combined.z).toBeCloseTo(expected.z, 6);
    expect(combined.w).toBeCloseTo(expected.w, 6);
  });

  it("mulQuat with identity is a no-op", () => {
    const q = yawQuat(0.9);
    expect(mulQuat(q, IDENTITY_QUAT)).toEqual(q);
    expect(mulQuat(IDENTITY_QUAT, q)).toEqual(q);
  });

  it("q ∘ conjugate(q) = identity", () => {
    const q = yawQuat(1.1);
    const r = mulQuat(q, conjugateQuat(q));
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(0, 6);
    expect(r.z).toBeCloseTo(0, 6);
    expect(r.w).toBeCloseTo(1, 6);
  });

  it("dotQuat is 1 for equal rotations, 0 for a 90° yaw apart", () => {
    expect(dotQuat(yawQuat(0.5), yawQuat(0.5))).toBeCloseTo(1, 6);
    // cos of half the 90° angle between them = cos(45°).
    expect(Math.abs(dotQuat(yawQuat(0), yawQuat(Math.PI / 2)))).toBeCloseTo(Math.cos(Math.PI / 4), 6);
  });
});
