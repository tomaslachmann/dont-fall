import type { IceDeck, MovingSegmentConfig } from "@dont-fall/shared";
import { CAPSULE_BOTTOM_OFFSET, eulerQuat, IDENTITY_QUAT, rotateVec3ByQuat, yawQuat } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createIceFooting, ICE_FOOTING_REACH } from "./iceFooting.js";

/** A 6×8 deck whose top is at y = 2. */
const DECK: IceDeck = {
  segmentIndex: 0,
  deck: { center: { x: 10, y: 2, z: 5 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 4 },
};

/** The capsule centre of a Character whose feet are at (x, feetY, z). */
const standing = (x: number, feetY: number, z: number) => ({ x, y: feetY + CAPSULE_BOTTOM_OFFSET, z });

const still = (decks: IceDeck[]) => {
  const scene = new THREE.Scene();
  return { scene, onIce: createIceFooting(decks, [], () => scene) };
};

describe("createIceFooting (ADR 0082)", () => {
  it("finds no ice on a Track without any", () => {
    expect(createIceFooting([], [], () => new THREE.Scene())(standing(0, 0, 0))).toBe(false);
  });

  it("stands on ice anywhere across the deck's footprint, on its top", () => {
    const { onIce } = still([DECK]);
    expect(onIce(standing(10, 2, 5))).toBe(true);
    expect(onIce(standing(12.9, 2, 1.1))).toBe(true);
  });

  it("is off the ice past the footprint's edge", () => {
    const { onIce } = still([DECK]);
    expect(onIce(standing(13.1, 2, 5))).toBe(false);
    expect(onIce(standing(10, 2, 9.1))).toBe(false);
  });

  it("is off the ice a jump above it, or on a floor below it", () => {
    const { onIce } = still([DECK]);
    expect(onIce(standing(10, 2 + ICE_FOOTING_REACH - 0.01, 5))).toBe(true);
    expect(onIce(standing(10, 2 + 0.5, 5))).toBe(false);
    expect(onIce(standing(10, 2 - 0.5, 5))).toBe(false);
  });

  it("follows a turned deck's footprint, not the world's axes", () => {
    const turned: IceDeck = { segmentIndex: 0, deck: { ...DECK.deck, yaw: Math.PI / 2, orientation: yawQuat(Math.PI / 2) } };
    const { onIce } = still([turned]);
    // Turned a quarter, the 8-long side runs along world X.
    expect(onIce(standing(13.9, 2, 5))).toBe(true);
    expect(onIce(standing(10, 2, 7.9))).toBe(true);
    expect(onIce(standing(10, 2, 8.1))).toBe(false);
  });

  it("stands on a pitched deck in its own plane — up the ramp as well as at its middle", () => {
    const orientation = eulerQuat(0, 0.4, 0);
    const ramp: IceDeck = { segmentIndex: 0, deck: { ...DECK.deck, orientation } };
    const { onIce } = still([ramp]);
    const upTheRamp = rotateVec3ByQuat({ x: 0, y: 0, z: -3 }, orientation);
    const feet = { x: 10 + upTheRamp.x, y: 2 + upTheRamp.y, z: 5 + upTheRamp.z };
    expect(Math.abs(upTheRamp.y)).toBeGreaterThan(1);
    expect(onIce(standing(feet.x, feet.y, feet.z))).toBe(true);
    // The same spot on a flat deck's height is well off this one.
    expect(onIce(standing(feet.x, 2, feet.z))).toBe(false);
  });

  it("rides a Moving Segment — the footing moves with the carrier's group", () => {
    const carrier: MovingSegmentConfig = {
      segmentIndex: 0,
      moduleId: "bar",
      position: { x: 10, y: 0, z: 5 },
      orientation: IDENTITY_QUAT,
      scale: 1,
      motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } },
      boxes: [],
      trimeshes: [],
      solids: [],
    };
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.position.set(10, 0, 5);
    scene.add(group);
    const onIce = createIceFooting([DECK], [carrier], (index) => (index === 0 ? group : scene));
    expect(onIce(standing(10, 2, 5))).toBe(true);

    // Slid 4 along X, as the Stage poses it.
    group.position.set(14, 0, 5);
    group.updateMatrixWorld(true);
    expect(onIce(standing(16.5, 2, 5))).toBe(true);
    expect(onIce(standing(10.5, 2, 5))).toBe(false);
  });

  it("finds whichever of several decks the Character is on", () => {
    const second: IceDeck = { segmentIndex: 1, deck: { ...DECK.deck, center: { x: -10, y: 0, z: 0 } } };
    const { onIce } = still([DECK, second]);
    expect(onIce(standing(-10, 0, 0))).toBe(true);
    expect(onIce(standing(10, 2, 5))).toBe(true);
    expect(onIce(standing(0, 0, 0))).toBe(false);
  });
});
