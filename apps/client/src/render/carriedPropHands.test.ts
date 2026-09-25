import { CARRY_GRIP, handsOffset, SPIN_GRIP } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CarriedPropPlacer, carrierHands } from "./carriedPropHands.js";

/** A model turned `yaw` about +Y, with its two hand bones where given (in its own space). */
const model = (yaw: number, left: THREE.Vector3Like, right: THREE.Vector3Like) => {
  const root = new THREE.Group();
  root.rotation.y = yaw;
  for (const [name, at] of [["handL", left], ["handR", right]] as const) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(at);
    root.add(bone);
  }
  return root;
};

describe("a carried Prop drawn in its carrier's hands (ADR 0128)", () => {
  it("hangs between the hands as the rig has them, as far out as the grip puts it", () => {
    const hands = carrierHands(model(Math.PI / 2, { x: 0.3, y: 1, z: 0.5 }, { x: -0.3, y: 1.2, z: 0.5 }));
    const at = new CarriedPropPlacer().place("a", hands, 0.2, false, 1 / 60, new THREE.Vector3());
    const off = handsOffset(0.2, CARRY_GRIP);

    // Turned a quarter: the model's forward (+Z) is the world's +X.
    expect(at!.x).toBeCloseTo(0.5 + off.forward, 6);
    expect(at!.y).toBeCloseTo(1.1 + off.up, 6);
    expect(at!.z).toBeCloseTo(0, 6);
  });

  it("moves to a Spin's grip over the arms' own crossfade, not in one frame", () => {
    const hands = carrierHands(model(0, { x: 0.3, y: 1, z: 0.5 }, { x: -0.3, y: 1, z: 0.5 }));
    const placer = new CarriedPropPlacer();
    const radius = 0.3;
    const carry = 0.5 + handsOffset(radius, CARRY_GRIP).forward;
    const spin = 0.5 + handsOffset(radius, SPIN_GRIP).forward;
    const z = (spinning: boolean, dt: number) => placer.place("a", hands, radius, spinning, dt, new THREE.Vector3())!.z;

    expect(z(false, 0.016)).toBeCloseTo(carry, 6);
    const partway = z(true, 0.05);
    expect(Math.abs(partway - carry)).toBeGreaterThan(0);
    expect(Math.abs(partway - spin)).toBeGreaterThan(0);
    expect(z(true, 1)).toBeCloseTo(spin, 6);
  });
});
