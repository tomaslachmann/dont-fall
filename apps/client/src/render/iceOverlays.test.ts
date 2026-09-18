import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { IceDeck, MovingSegmentConfig } from "@dont-fall/shared";
import { eulerQuat, IDENTITY_QUAT } from "@dont-fall/shared";
import { ICE_SEAT_LIFT } from "@dont-fall/render";
import { buildIceOverlays } from "./iceOverlays.js";

const DECK: IceDeck = {
  segmentIndex: 0,
  deck: { center: { x: 10, y: 2, z: 5 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 4 },
};

/** A carrier turned half round, sliding — its local frame is not the world's. */
const CARRIER: MovingSegmentConfig = {
  segmentIndex: 0,
  moduleId: "bar",
  position: { x: 10, y: 0, z: 5 },
  orientation: { x: 0, y: 1, z: 0, w: 0 },
  scale: 1,
  motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } },
  boxes: [],
  trimeshes: [],
  solids: [],
};

const bodyOf = (object: THREE.Object3D): THREE.Mesh => object.getObjectByName("ice-body") as THREE.Mesh;

describe("buildIceOverlays (ADR 0066, drawn per ADR 0107)", () => {
  it("builds nothing for a Track without ice", () => {
    expect(buildIceOverlays([], [])).toEqual([]);
  });

  it("seats the slab on its deck, tilted with a pitched deck so it stands on the ramp", () => {
    const orientation = eulerQuat(0, -0.25, 0.1);
    const [sheet] = buildIceOverlays([{ segmentIndex: 0, deck: { ...DECK.deck, orientation } }], []);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));

    expect(sheet!.movingIndex).toBeNull();
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.quaternion).distanceTo(up)).toBeCloseTo(0, 9);
    expect(sheet!.object.position.distanceTo(new THREE.Vector3(10, 2, 5).addScaledVector(up, ICE_SEAT_LIFT))).toBeCloseTo(0, 9);
  });

  it("rides a Moving Segment in its carrier's own frame", () => {
    const [sheet] = buildIceOverlays([DECK], [CARRIER]);
    expect(sheet!.movingIndex).toBe(0);
    // The deck sits at world (10, 2, 5); the carrier's frame is turned half
    // round about y at (10, 0, 5), so in that frame the slab is at its local
    // origin, y 2 up.
    expect(sheet!.object.position.x).toBeCloseTo(0, 6);
    expect(sheet!.object.position.y).toBeCloseTo(2 + ICE_SEAT_LIFT, 6);
    expect(sheet!.object.position.z).toBeCloseTo(0, 6);
  });

  it("is an opaque pastel slab with real thickness — never a translucent decal (ADR 0107)", () => {
    const [sheet] = buildIceOverlays([DECK], []);
    const body = bodyOf(sheet!.object);
    const material = body.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(false);
    expect(material.vertexColors).toBe(true);
    body.geometry.computeBoundingBox();
    expect(body.geometry.boundingBox!.max.y).toBeGreaterThan(0.05);
  });

  it("glints on the game's clock without complaint — a pure function of the time", () => {
    const [sheet] = buildIceOverlays([DECK], []);
    expect(() => {
      sheet!.update(0);
      sheet!.update(3.7);
      sheet!.update(3.7);
    }).not.toThrow();
  });
});
