import { describe, expect, it } from "vitest";
import {
  conjugateQuat,
  dotQuat,
  eulerQuat,
  IDENTITY_QUAT,
  mulQuat,
  pitchQuat,
  quatToEuler,
  rollQuat,
  yawQuat,
} from "./quat.js";

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

const rotateByQuat = (v: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }) => {
  const u = { x: q.x, y: q.y, z: q.z };
  const cross = (a: typeof u, b: typeof u) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return { x: v.x + 2 * q.w * uv.x + 2 * uuv.x, y: v.y + 2 * q.w * uv.y + 2 * uuv.y, z: v.z + 2 * q.w * uv.z + 2 * uuv.z };
};

const closeVec = (v: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }): void => {
  expect(v.x).toBeCloseTo(expected.x, 8);
  expect(v.y).toBeCloseTo(expected.y, 8);
  expect(v.z).toBeCloseTo(expected.z, 8);
};

describe("pitchQuat (ADR 0034 — Segment tilt)", () => {
  it("is the identity at 0", () => {
    expect(pitchQuat(0)).toEqual(IDENTITY_QUAT);
  });

  it("composes additively — pitch(a) ∘ pitch(b) = pitch(a + b)", () => {
    const combined = mulQuat(pitchQuat(0.3), pitchQuat(0.4));
    const expected = pitchQuat(0.7);
    expect(combined.x).toBeCloseTo(expected.x, 6);
    expect(combined.w).toBeCloseTo(expected.w, 6);
  });

  it("rotates the local Z axis toward -Y at +90°pitch (tilting forward)", () => {
    closeVec(rotateByQuat({ x: 0, y: 0, z: 1 }, pitchQuat(Math.PI / 2)), { x: 0, y: -1, z: 0 });
  });
});

describe("rollQuat (ADR 0034 — Segment tilt)", () => {
  it("is the identity at 0", () => {
    expect(rollQuat(0)).toEqual(IDENTITY_QUAT);
  });

  it("composes additively — roll(a) ∘ roll(b) = roll(a + b)", () => {
    const combined = mulQuat(rollQuat(0.3), rollQuat(0.4));
    const expected = rollQuat(0.7);
    expect(combined.x).toBeCloseTo(expected.x, 6);
    expect(combined.w).toBeCloseTo(expected.w, 6);
  });

  it("rotates the local X axis toward +Y at +90° roll (banking)", () => {
    closeVec(rotateByQuat({ x: 1, y: 0, z: 0 }, rollQuat(Math.PI / 2)), { x: 0, y: 1, z: 0 });
  });
});

describe("eulerQuat (ADR 0034 — yaw/pitch/roll composition, yaw outermost)", () => {
  it("reduces to the single-axis quaternion when the other two angles are 0", () => {
    for (const a of [0.3, -1.1, Math.PI / 2]) {
      const yawOnly = eulerQuat(a, 0, 0);
      expect(yawOnly.y).toBeCloseTo(yawQuat(a).y, 10);
      expect(yawOnly.w).toBeCloseTo(yawQuat(a).w, 10);

      const pitchOnly = eulerQuat(0, a, 0);
      expect(pitchOnly.x).toBeCloseTo(pitchQuat(a).x, 10);
      expect(pitchOnly.w).toBeCloseTo(pitchQuat(a).w, 10);

      const rollOnly = eulerQuat(0, 0, a);
      expect(rollOnly.z).toBeCloseTo(rollQuat(a).z, 10);
      expect(rollOnly.w).toBeCloseTo(rollQuat(a).w, 10);
    }
  });

  it("composes yaw ∘ pitch ∘ roll in that order (yaw applied last/outermost)", () => {
    const combined = eulerQuat(0.4, 0.5, 0.6);
    const expected = mulQuat(mulQuat(yawQuat(0.4), pitchQuat(0.5)), rollQuat(0.6));
    expect(combined).toEqual(expected);
  });
});

describe("quatToEuler (ADR 0034 — the inverse of eulerQuat, for storing a Segment's tilt as yaw/pitch/roll)", () => {
  const anglesDeg = [-90, -75, -45, -30, -15, 0, 15, 30, 45, 75, 90];
  const anglesRad = anglesDeg.map((d) => (d * Math.PI) / 180);

  it("round-trips every combination of clean 15°-grid angles back to an equivalent rotation", () => {
    for (const yaw of anglesRad) {
      for (const pitch of anglesRad) {
        // Excludes the exact ±90° pitch gimbal-lock singularity, where yaw
        // and roll aren't independently recoverable — a known, accepted
        // limitation of Euler storage (ADR 0034), not a bug.
        if (Math.abs(Math.abs(pitch) - Math.PI / 2) < 1e-6) continue;
        for (const roll of anglesRad) {
          const original = eulerQuat(yaw, pitch, roll);
          const extracted = quatToEuler(original);
          const roundTripped = eulerQuat(extracted.yaw, extracted.pitch, extracted.roll);
          // Same rotation, not necessarily the same (yaw,pitch,roll) triple —
          // |dot| = 1 means equal rotations (a quaternion and its negation
          // represent the same rotation).
          expect(Math.abs(dotQuat(original, roundTripped))).toBeCloseTo(1, 6);
        }
      }
    }
  });

  it("extracts (0, 0, 0) for the identity", () => {
    const euler = quatToEuler(IDENTITY_QUAT);
    expect(euler.yaw).toBeCloseTo(0, 10);
    expect(euler.pitch).toBeCloseTo(0, 10);
    expect(euler.roll).toBeCloseTo(0, 10);
  });
});
