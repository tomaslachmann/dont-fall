import { describe, expect, it } from "vitest";
import { movementDirection, type MovementKeys } from "./movementDirection.js";

const keys = (partial: Partial<MovementKeys>): MovementKeys => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  ...partial,
});

const HALF_ROT = Math.PI / 2;

describe("movementDirection", () => {
  it("maps forward to north (-Z) when the camera faces default yaw", () => {
    const dir = movementDirection(keys({ forward: true }), 0);
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.z).toBeCloseTo(-1, 6);
  });

  it("rotates forward with camera yaw — a quarter turn points forward east (+X)", () => {
    const dir = movementDirection(keys({ forward: true }), HALF_ROT);
    expect(dir.x).toBeCloseTo(1, 6);
    expect(dir.z).toBeCloseTo(0, 6);
  });

  it("maps strafe-right to east (+X) at default yaw", () => {
    const dir = movementDirection(keys({ right: true }), 0);
    expect(dir.x).toBeCloseTo(1, 6);
    expect(dir.z).toBeCloseTo(0, 6);
  });

  it("returns a normalised diagonal for forward+right", () => {
    const dir = movementDirection(keys({ forward: true, right: true }), 0);
    expect(dir.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(dir.z).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it("cancels opposing keys to a zero vector", () => {
    expect(movementDirection(keys({ forward: true, back: true }), 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("returns a zero vector when nothing is held", () => {
    expect(movementDirection(keys({}), 1.234)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("never has a vertical component", () => {
    const dir = movementDirection(keys({ forward: true, left: true }), 2.1);
    expect(dir.y).toBe(0);
  });
});
