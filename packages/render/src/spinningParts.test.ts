import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { findSpinningParts, spinParts, spinRate } from "./spinningParts.js";

const marked = (spin: unknown): THREE.Object3D => {
  const object = new THREE.Object3D();
  object.userData.spin = spin;
  return object;
};

describe("spinning parts", () => {
  it("reads the rate an Asset marked, and nothing else", () => {
    expect(spinRate(marked(14))).toBe(14);
    expect(spinRate(marked(-3))).toBe(-3);
    expect(spinRate(marked(0))).toBeNull();
    expect(spinRate(marked("14"))).toBeNull();
    expect(spinRate(marked(Number.NaN))).toBeNull();
    expect(spinRate(new THREE.Object3D())).toBeNull();
  });

  it("finds marked nodes anywhere under a root, and in every clone of it", () => {
    const template = new THREE.Group();
    const housing = new THREE.Object3D();
    const rotor = marked(14);
    template.add(housing, rotor);
    const placed = new THREE.Group();
    placed.add(template.clone(true), template.clone(true));

    const parts = findSpinningParts(placed);
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => spinRate(part) === 14)).toBe(true);
  });

  it("turns each part about its own Y, absolutely on the clock", () => {
    const rotor = marked(14);
    const backwards = marked(-2);
    spinParts([rotor, backwards], 100);
    expect(rotor.rotation.y).toBeCloseTo(1.4, 10);
    expect(backwards.rotation.y).toBeCloseTo(-0.2, 10);
    expect(rotor.rotation.x).toBe(0);
    expect(rotor.rotation.z).toBe(0);
    // The same moment always draws the same angle.
    spinParts([rotor], 3000);
    spinParts([rotor], 100);
    expect(rotor.rotation.y).toBeCloseTo(1.4, 10);
  });

  it("keeps the angle within one turn however long the session runs", () => {
    const rotor = marked(14);
    spinParts([rotor], 10 * 60 * 60 * 1000);
    expect(Math.abs(rotor.rotation.y)).toBeLessThan(Math.PI * 2);
  });

  it("leaves a part that lost its mark alone", () => {
    const rotor = marked(14);
    rotor.rotation.set(0, 0.5, 0);
    rotor.userData.spin = undefined;
    spinParts([rotor], 1000);
    expect(rotor.rotation.y).toBe(0.5);
  });
});
