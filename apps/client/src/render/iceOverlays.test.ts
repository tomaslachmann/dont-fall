import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { IceDeck, MovingSegmentConfig } from "@dont-fall/shared";
import { eulerQuat, ICE_OVERLAY_LIFT, ICE_OVERLAY_OPACITY, ICE_TEXTURE_FILE, IDENTITY_QUAT, yawQuat } from "@dont-fall/shared";
import { buildIceOverlays, loadIceTexture } from "./iceOverlays.js";

const DECK: IceDeck = {
  segmentIndex: 0,
  deck: { center: { x: 10, y: 2, z: 5 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 4 },
};

describe("buildIceOverlays (ADR 0066)", () => {
  const texture = (): THREE.Texture => new THREE.Texture();

  it("builds nothing for a Track without ice", () => {
    expect(buildIceOverlays([], [], texture())).toEqual([]);
  });

  it("sheets the deck top in the footprint's own frame — flat, lifted, yawed with the deck", () => {
    const [sheet] = buildIceOverlays([DECK], [], texture());
    expect(sheet!.movingIndex).toBeNull();
    expect(sheet!.object.position.x).toBeCloseTo(10, 10);
    expect(sheet!.object.position.z).toBeCloseTo(5, 10);
    expect(sheet!.object.position.y).toBeCloseTo(2 + ICE_OVERLAY_LIFT, 10);

    // Flat on the deck: the plane's own +Y (its normal) still points up…
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.quaternion);
    expect(normal.x).toBeCloseTo(0, 10);
    expect(normal.y).toBeCloseTo(1, 10);
    expect(normal.z).toBeCloseTo(0, 10);
    // …and at yaw 0 the sheet's width runs along world X, like the footprint.
    sheet!.object.geometry.computeBoundingBox();
    const box = sheet!.object.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(6, 10);
    expect(box.max.z - box.min.z).toBeCloseTo(8, 10);
  });

  it("yaws the sheet with a turned deck, keeping the footprint's own extents", () => {
    const turned: IceDeck = { segmentIndex: 0, deck: { ...DECK.deck, yaw: Math.PI / 2, orientation: yawQuat(Math.PI / 2) } };
    const [sheet] = buildIceOverlays([turned], [], texture());

    // The sheet's local +X (its width) lands on the yawed footprint's X.
    const width = new THREE.Vector3(1, 0, 0).applyQuaternion(sheet!.object.quaternion);
    expect(width.x).toBeCloseTo(0, 9);
    expect(width.z).toBeCloseTo(-1, 9);
  });

  it("lies in a pitched deck's own plane — tilted with it and lifted along its up, not flat over the ramp", () => {
    const orientation = eulerQuat(0.4, 0.3, 0);
    const pitched: IceDeck = { segmentIndex: 0, deck: { ...DECK.deck, yaw: 0.4, orientation } };
    const [sheet] = buildIceOverlays([pitched], [], texture());
    const q = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.quaternion);
    expect(normal.distanceTo(up)).toBeCloseTo(0, 9);
    const expected = new THREE.Vector3(10, 2, 5).addScaledVector(up, ICE_OVERLAY_LIFT);
    expect(sheet!.object.position.distanceTo(expected)).toBeCloseTo(0, 9);
  });

  it("lays the shared texture translucent over the deck — tiled by deck size, never stretched to fit", () => {
    const master = texture();
    master.colorSpace = THREE.SRGBColorSpace; // what the loader produces; the clone must carry it
    const [sheet] = buildIceOverlays([DECK], [], master);
    const material = sheet!.object.material as THREE.MeshStandardMaterial;

    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(ICE_OVERLAY_OPACITY, 10);
    expect(material.polygonOffset).toBe(true);
    // A clone, not the master: the repeat below is this deck's own.
    expect(material.map).not.toBe(master);
    expect(material.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(material.map!.wrapT).toBe(THREE.RepeatWrapping);
    // 6×8 deck on a 2-unit tile: 3×4 repeats.
    expect(material.map!.repeat.x).toBeCloseTo(3, 10);
    expect(material.map!.repeat.y).toBeCloseTo(4, 10);
    expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("a sheet riding a Moving Segment parents under its group, in its local frame", () => {
    const carrier: MovingSegmentConfig = {
      segmentIndex: 0,
      moduleId: "bar",
      position: { x: 10, y: 0, z: 5 },
      orientation: { x: 0, y: 1, z: 0, w: 0 }, // 180° yaw
      scale: 1,
      motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } },
      boxes: [],
      trimeshes: [],
      solids: [],
    };
    const [sheet] = buildIceOverlays([DECK], [carrier], texture());
    expect(sheet!.movingIndex).toBe(0);

    // Composes back to the world rest frame under the carrier's own placement —
    // the same local-frame contract the carrier's box visuals keep.
    const group = new THREE.Group();
    group.position.set(carrier.position.x, carrier.position.y, carrier.position.z);
    group.quaternion.set(carrier.orientation.x, carrier.orientation.y, carrier.orientation.z, carrier.orientation.w);
    group.add(sheet!.object);
    group.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    sheet!.object.getWorldPosition(world);
    expect(world.x).toBeCloseTo(10, 9);
    expect(world.y).toBeCloseTo(2 + ICE_OVERLAY_LIFT, 9);
    expect(world.z).toBeCloseTo(5, 9);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.getWorldQuaternion(new THREE.Quaternion()));
    expect(normal.y).toBeCloseTo(1, 9);
  });
});

describe("loadIceTexture (ADR 0066)", () => {
  it("fetches the served texture file and wraps the decoded bitmap colour-correctly", async () => {
    const seen: string[] = [];
    const bitmap = {} as ImageBitmap;
    const texture = await loadIceTexture(
      async (url) => {
        seen.push(url);
        return new Uint8Array([1, 2, 3]);
      },
      "http://assets.test",
      async (bytes) => {
        expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
        return bitmap;
      },
    );

    expect(seen).toEqual([`http://assets.test/${ICE_TEXTURE_FILE}`]);
    expect(texture.image).toBe(bitmap);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
