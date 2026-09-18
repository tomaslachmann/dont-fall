import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CARRY_DRAWN_DROP,
  CARRY_DRAWN_PULL,
  CARRY_MAX_STREAM,
  carriedFlail,
  restCarriedHang,
} from "./carriedFlail.js";

/** Facing 0 means the grabber is toward −z; outward (away from it) is +z. */
const CENTRE = { x: 0, y: 1.25, z: 0 };
const FEET_BELOW = 0.85;

const settled = (velocity: { x: number; y: number; z: number }) => {
  const state = restCarriedHang();
  // One huge step converges the eased hang onto its target.
  return { state, placed: carriedFlail(state, { centre: CENTRE, facing: 0, velocity }, 0.4, FEET_BELOW, 10) };
};

describe("carriedFlail (ADR 0104's drawn hold)", () => {
  it("hangs straight down in the hands at rest — pulled toward the grabber, and a little lower", () => {
    const { state, placed } = settled({ x: 0, y: 0, z: 0 });
    expect(state.hang.y).toBeCloseTo(-1, 6);
    expect(placed.feet.x).toBeCloseTo(CENTRE.x, 6);
    expect(placed.feet.y).toBeCloseTo(CENTRE.y - CARRY_DRAWN_DROP - FEET_BELOW, 6);
    expect(placed.feet.z).toBeCloseTo(CENTRE.z - CARRY_DRAWN_PULL, 6);
    // Untilted: the quaternion is the plain yaw.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(placed.quaternion);
    expect(up.y).toBeCloseTo(1, 6);
  });

  it("streams out with the carry's speed: feet away from the grabber and higher, head staying at the grip", () => {
    const rest = settled({ x: 0, y: 0, z: 0 }).placed;
    // A full Spin whirls the carry point at ~10.4 u/s, here along +x (the tangent).
    const { state, placed } = settled({ x: 10.4, y: 0, z: 0 });
    // The hang tips away from the grabber (+z) and trails the travel (−x).
    expect(state.hang.z).toBeGreaterThan(0.3);
    expect(state.hang.x).toBeLessThan(0);
    expect(placed.feet.z).toBeGreaterThan(rest.feet.z + 0.4);
    expect(placed.feet.y).toBeGreaterThan(rest.feet.y + 0.3);
    // The rig's up runs along the hang, grip-ward.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(placed.quaternion);
    expect(up.x).toBeCloseTo(-state.hang.x, 6);
    expect(up.y).toBeCloseTo(-state.hang.y, 6);
    expect(up.z).toBeCloseTo(-state.hang.z, 6);
  });

  it("never streams past the cap, however hard it is whirled", () => {
    const { state } = settled({ x: 100, y: 0, z: 0 });
    const fromDown = state.hang.angleTo(new THREE.Vector3(0, -1, 0));
    expect(fromDown).toBeLessThanOrEqual(CARRY_MAX_STREAM + 1e-6);
  });

  it("eases toward the stream instead of snapping to it", () => {
    const state = restCarriedHang();
    const body = { centre: CENTRE, facing: 0, velocity: { x: 10.4, y: 0, z: 0 } };
    carriedFlail(state, body, 0.4, FEET_BELOW, 1 / 60);
    const early = state.hang.angleTo(new THREE.Vector3(0, -1, 0));
    for (let i = 0; i < 200; i += 1) carriedFlail(state, body, 0.4, FEET_BELOW, 1 / 60);
    const late = state.hang.angleTo(new THREE.Vector3(0, -1, 0));
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(late * 0.4);
  });
});
