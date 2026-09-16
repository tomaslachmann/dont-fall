import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { MovingSegmentConfig, MudDeck, Vec3 } from "@dont-fall/shared";
import {
  CAPSULE_BOTTOM_OFFSET,
  MUD_OVERLAY_LIFT,
  MUD_RIPPLE_ABOVE_LIFT,
  MUD_RIPPLE_LIFETIME_SECONDS,
  MUD_RIPPLE_MIN_RADIUS,
  MUD_RIPPLE_OPACITY,
  MUD_RIPPLE_POOL_SIZE,
  MUD_SIDE_COLOR,
  MUD_TEXTURE_FILE,
  IDENTITY_QUAT,
  eulerQuat,
  mudSloshOffset,
} from "@dont-fall/shared";
import { buildMudOverlays, loadMudTexture } from "./mudOverlays.js";

const DECK: MudDeck = {
  segmentIndex: 0,
  deck: { center: { x: 10, y: 2, z: 5 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 4 },
};

describe("buildMudOverlays (ADR 0067)", () => {
  const texture = (): THREE.Texture => new THREE.Texture();

  it("builds nothing for a Track without mud", () => {
    expect(buildMudOverlays([], [], texture())).toEqual([]);
  });

  it("tilts the block with a pitched deck, its surface parallel to the ramp", () => {
    const orientation = eulerQuat(0, -0.25, 0.1);
    const [sheet] = buildMudOverlays([{ segmentIndex: 0, deck: { ...DECK.deck, orientation } }], [], texture());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));

    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.quaternion).distanceTo(up)).toBeCloseTo(0, 9);
    expect(sheet!.object.position.distanceTo(new THREE.Vector3(10, 2, 5).addScaledVector(up, MUD_OVERLAY_LIFT / 2))).toBeCloseTo(0, 9);
  });

  it("fills the deck top ankle-deep — a block, footprint-sized, yawed with the deck", () => {
    const [sheet] = buildMudOverlays([DECK], [], texture());
    expect(sheet!.movingIndex).toBeNull();
    expect(sheet!.object.position.x).toBeCloseTo(10, 10);
    expect(sheet!.object.position.z).toBeCloseTo(5, 10);
    // Raised, not a decal's lift: feet at deck level sink below the mud.
    expect(MUD_OVERLAY_LIFT).toBeGreaterThan(0.05);
    // Centred vertically: the surface sits half the lift above the origin.
    expect(sheet!.object.position.y).toBeCloseTo(2 + MUD_OVERLAY_LIFT / 2, 10);

    // Flat on the deck: the block's own +Y still points up.
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.quaternion);
    expect(normal.x).toBeCloseTo(0, 10);
    expect(normal.y).toBeCloseTo(1, 10);
    expect(normal.z).toBeCloseTo(0, 10);
    sheet!.object.geometry.computeBoundingBox();
    const box = sheet!.object.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(6, 10);
    expect(box.max.z - box.min.z).toBeCloseTo(8, 10);
    // The filled gap: the block runs the whole lift down to the deck top
    // (f32 geometry, so a looser precision than the f64 positions above).
    expect(box.max.y - box.min.y).toBeCloseTo(MUD_OVERLAY_LIFT, 6);
    expect(sheet!.object.position.y + box.max.y).toBeCloseTo(2 + MUD_OVERLAY_LIFT, 6);
    expect(sheet!.object.position.y + box.min.y).toBeCloseTo(2, 6);
  });

  it("lays the shared texture opaque on top, cut earth down the sides — tiled by deck size", () => {
    const master = texture();
    master.colorSpace = THREE.SRGBColorSpace; // what the loader produces; the clone must carry it
    const [sheet] = buildMudOverlays([DECK], [], master);
    const materials = sheet!.object.material as THREE.MeshStandardMaterial[];
    expect(materials).toHaveLength(6);

    // Box faces [+x, -x, +y, -y, +z, -z]: the texture rides the +y top.
    const top = materials[2]!;
    expect(top.transparent).toBe(false);
    expect(top.polygonOffset).toBe(true);
    // A clone, not the master: the repeat below is this deck's own.
    expect(top.map).not.toBe(master);
    expect(top.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(top.map!.wrapT).toBe(THREE.RepeatWrapping);
    // 6×8 deck on a 2-unit tile: 3×4 repeats.
    expect(top.map!.repeat.x).toBeCloseTo(3, 10);
    expect(top.map!.repeat.y).toBeCloseTo(4, 10);
    expect(top.map!.colorSpace).toBe(THREE.SRGBColorSpace);

    // Every other face is the untextured fill — the gap is mud, not air.
    for (const i of [0, 1, 3, 4, 5]) {
      expect(materials[i]!.map).toBeNull();
      expect(materials[i]!.color.getHex()).toBe(MUD_SIDE_COLOR);
    }
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
    const [sheet] = buildMudOverlays([DECK], [carrier], texture());
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
    expect(world.y).toBeCloseTo(2 + MUD_OVERLAY_LIFT / 2, 9);
    expect(world.z).toBeCloseTo(5, 9);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.getWorldQuaternion(new THREE.Quaternion()));
    expect(normal.y).toBeCloseTo(1, 9);
  });
});

describe("MudSheet.update (living mud)", () => {
  const texture = (): THREE.Texture => new THREE.Texture();
  // Feet planted on the deck top (y=2) read through the capsule centre the stage stashes.
  const standing: Vec3 = { x: 10, y: 2 + CAPSULE_BOTTOM_OFFSET, z: 5 };

  const placed = () => {
    const [sheet] = buildMudOverlays([DECK], [], texture());
    const scene = new THREE.Scene();
    scene.add(sheet!.object);
    scene.updateMatrixWorld(true);
    return sheet!;
  };
  const topMap = (sheet: ReturnType<typeof placed>): THREE.Texture =>
    (sheet.object.material as THREE.MeshStandardMaterial[])[2]!.map!;
  const visibleRings = (sheet: ReturnType<typeof placed>): THREE.Object3D[] =>
    sheet.object.children.filter((child) => child.visible);

  it("breathes the texture offset off sim time — the surface never sits still", () => {
    const sheet = placed();
    sheet.update(1.3, []);
    const slosh = mudSloshOffset(1.3, 0); // segmentIndex 0: zero phase
    expect(topMap(sheet).offset.x).toBeCloseTo(slosh.u, 10);
    expect(topMap(sheet).offset.y).toBeCloseTo(slosh.v, 10);
    sheet.update(4.1, []);
    const later = mudSloshOffset(4.1, 0);
    expect(topMap(sheet).offset.x).toBeCloseTo(later.u, 10);
    expect(topMap(sheet).offset.y).toBeCloseTo(later.v, 10);
  });

  it("ripples under feet walking through it — born small and opaque, on the mud top", () => {
    const sheet = placed();
    sheet.update(1, [standing]);
    const rings = visibleRings(sheet);
    expect(rings).toHaveLength(1);
    expect(rings[0]!.position.x).toBeCloseTo(0, 9);
    expect(rings[0]!.position.z).toBeCloseTo(0, 9);
    expect(rings[0]!.position.y).toBeGreaterThan(MUD_OVERLAY_LIFT / 2);
    expect(rings[0]!.scale.x).toBeCloseTo(MUD_RIPPLE_MIN_RADIUS, 9);
    const born = (rings[0]! as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(born.opacity).toBeCloseTo(MUD_RIPPLE_OPACITY, 9);
  });

  it("ripples nothing for feet beside the deck — or jumping over the mud", () => {
    const beside = placed();
    beside.update(1, [{ ...standing, x: 100 }]);
    expect(visibleRings(beside)).toHaveLength(0);

    const jumping = placed();
    jumping.update(1, [{ ...standing, y: standing.y + MUD_OVERLAY_LIFT + MUD_RIPPLE_ABOVE_LIFT + 0.5 }]);
    expect(visibleRings(jumping)).toHaveLength(0);
  });

  it("expands, fades, and retires each ring over its lifetime", () => {
    const sheet = placed();
    sheet.update(1, [standing]);
    sheet.update(1 + MUD_RIPPLE_LIFETIME_SECONDS / 2, []);
    const mid = visibleRings(sheet);
    expect(mid).toHaveLength(1);
    expect(mid[0]!.scale.x).toBeGreaterThan(MUD_RIPPLE_MIN_RADIUS);
    expect(((mid[0]! as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity).toBeLessThan(MUD_RIPPLE_OPACITY);
    sheet.update(1 + MUD_RIPPLE_LIFETIME_SECONDS + 0.1, []);
    expect(visibleRings(sheet)).toHaveLength(0);
  });

  it("ripples in a moving carrier's own frame — the feet map through the placement", () => {
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
    const [sheet] = buildMudOverlays([DECK], [carrier], texture());
    const group = new THREE.Group();
    group.position.set(carrier.position.x, carrier.position.y, carrier.position.z);
    group.quaternion.set(carrier.orientation.x, carrier.orientation.y, carrier.orientation.z, carrier.orientation.w);
    group.add(sheet!.object);
    group.updateMatrixWorld(true);
    // Feet a unit off-centre in world space — mapped through the 180°
    // carrier into the sheet frame, the ring lands exactly under the feet
    // (a naive world-XZ placement would strand it at x=11, off the block).
    sheet!.update(1, [{ x: 11, y: 2 + CAPSULE_BOTTOM_OFFSET, z: 5 }]);
    const rings = sheet!.object.children.filter((child) => child.visible);
    expect(rings).toHaveLength(1);
    expect(rings[0]!.position.x).toBeCloseTo(1, 9);
    expect(rings[0]!.position.z).toBeCloseTo(0, 9);
  });

  it("a crowd crossing one deck still ripples — the pool steals the oldest slot", () => {
    const sheet = placed();
    const crowd: Vec3[] = Array.from({ length: MUD_RIPPLE_POOL_SIZE + 1 }, (_, i) => ({
      ...standing,
      x: standing.x - 2 + (i % 5),
      z: standing.z - 1 + Math.floor(i / 5),
    }));
    sheet.update(1, crowd);
    expect(visibleRings(sheet)).toHaveLength(MUD_RIPPLE_POOL_SIZE);
  });
});

describe("loadMudTexture (ADR 0067)", () => {
  it("fetches the served texture file and wraps the decoded bitmap colour-correctly", async () => {
    const seen: string[] = [];
    const bitmap = {} as ImageBitmap;
    const texture = await loadMudTexture(
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

    expect(seen).toEqual([`http://assets.test/${MUD_TEXTURE_FILE}`]);
    expect(texture.image).toBe(bitmap);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
