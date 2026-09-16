import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ConveyorBelt, MovingSegmentConfig } from "@dont-fall/shared";
import { chevronPose, eulerQuat, IDENTITY_QUAT, stripLayout } from "@dont-fall/shared";
import { buildConveyorStrips } from "./conveyorBelts.js";

const BELT: ConveyorBelt = {
  segmentIndex: 0,
  velocity: { x: 0, y: 0, z: -4 },
  deck: { center: { x: 10, y: 2, z: 5 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 4 },
};

const chevronMeshes = (strip: { object: THREE.Group }): THREE.Mesh[] =>
  strip.object.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && (c.geometry as THREE.BufferGeometry).type === "ShapeGeometry",
  );

describe("buildConveyorStrips (ADR 0064)", () => {
  it("builds nothing for a Track without belts", () => {
    expect(buildConveyorStrips([], [])).toEqual([]);
  });

  it("frames the strip on the deck, facing the flow — chevrons point where the belt carries", () => {
    const [strip] = buildConveyorStrips([BELT], []);
    expect(strip!.movingIndex).toBeNull();
    expect(strip!.object.position.x).toBeCloseTo(10, 10);
    expect(strip!.object.position.z).toBeCloseTo(5, 10);
    expect(strip!.object.position.y).toBeGreaterThan(2); // lifted just above the deck top

    // The chevrons' own forward (-Z) lands on the belt flow, exactly.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(strip!.object.quaternion);
    expect(forward.x).toBeCloseTo(0, 10);
    expect(forward.y).toBeCloseTo(0, 10);
    expect(forward.z).toBeCloseTo(-1, 10);

    // A real grid of them on a 6×8 deck, not a token single arrow.
    expect(chevronMeshes(strip!).length).toBeGreaterThan(4);
  });

  it("lays the strip on a pitched deck's own surface, pointing up or down the slope — never floating level over it", () => {
    const orientation = eulerQuat(0, 0.16, 0); // a ramp rising along −Z
    const [strip] = buildConveyorStrips([{ ...BELT, deck: { ...BELT.deck, orientation } }], []);
    const q = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const upSlope = new THREE.Vector3(0, 0, -1).applyQuaternion(q);

    // In the deck's plane: the strip's own up is the deck's, its forward runs along the slope.
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(strip!.object.quaternion).distanceTo(up)).toBeCloseTo(0, 9);
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(strip!.object.quaternion).distanceTo(upSlope)).toBeCloseTo(0, 9);
    // Seated on the deck top's centre, a decal's lift along the deck's up.
    expect(strip!.object.position.distanceTo(new THREE.Vector3(10, 2, 5).addScaledVector(up, 0.015))).toBeCloseTo(0, 9);
  });

  it("paints KayKit-white arrows straight on the deck — no dark plate, a decal's lift", () => {
    const [strip] = buildConveyorStrips([BELT], []);
    expect(strip!.object.position.y).toBeCloseTo(2.015, 10);

    const meshes = strip!.object.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes.length).toBeGreaterThan(0);
    // Every mesh is a chevron — the retired dark plate is gone, so the deck's
    // own coloured top shows through and the arrows read as printed on it.
    expect(meshes.every((m) => (m.geometry as THREE.BufferGeometry).type === "ShapeGeometry")).toBe(true);
    // ... and at rest every chevron sits flat at the group's own height — the
    // lift lives in one place, and the rest pose is structurally outside
    // the fold (see `chevronPose`).
    expect(meshes.every((m) => m.position.y === 0)).toBe(true);
    expect(meshes.every((m) => m.rotation.x === 0)).toBe(true);

    const mat = meshes[0]!.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mat.polygonOffset).toBe(true);

    // The KayKit `platform_arrow` glyph: 1.2 wide, 0.82 deep, the tip toward −Z (the flow).
    const geo = meshes[0]!.geometry as THREE.BufferGeometry;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(1.2, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(0.82, 5);
    expect(box.min.z).toBeCloseTo(-0.41, 5);
  });

  it("marches every chevron toward the flow at the belt's own true speed", () => {
    const [strip] = buildConveyorStrips([BELT], []);
    const chevrons = chevronMeshes(strip!);
    // The BELT's own 6×8 deck at flow −Z: halfL 4, halfW 3.
    const layout = stripLayout(4, 3);

    strip!.update(0.1); // 0.1s × 4 u/s = 0.4 units of march
    for (const chevron of chevrons) {
      // Rendered meshes follow the shared pose exactly — march, sink, pitch
      // and pullback composed in one call, so the z-spaces can never split.
      const expected = chevronPose(layout, chevron.userData.marchIndex as number, 0.4);
      expect(chevron.position.z).toBeCloseTo(expected.z, 10);
      expect(chevron.position.y).toBeCloseTo(expected.y, 10);
      expect(chevron.rotation.x).toBeCloseTo(expected.pitch, 10);
    }
    // ... with at least one chevron visibly moved backward along -Z by the
    // full 0.4 — flat-zone travel, no wrap and no fold pullback involved.
    strip!.update(0);
    const before = chevrons.map((c) => c.position.z);
    strip!.update(0.1);
    expect(chevrons.some((c, i) => Math.abs(before[i]! - c.position.z - 0.4) < 1e-9)).toBe(true);
  });

  it("folds chevrons over the deck edge at the travel ends — half on top, half bending down", () => {
    const [strip] = buildConveyorStrips([BELT], []);
    const chevrons = chevronMeshes(strip!);
    // The BELT's own 6×8 deck at flow −Z: halfL 4, halfW 3.
    const layout = stripLayout(4, 3);

    strip!.update(0.95); // 0.95s × 4 u/s = 3.8 units of march
    for (const chevron of chevrons) {
      const expected = chevronPose(layout, chevron.userData.marchIndex as number, 3.8);
      expect(chevron.position.z).toBeCloseTo(expected.z, 10);
      expect(chevron.position.y).toBeCloseTo(expected.y, 10);
      expect(chevron.rotation.x).toBeCloseTo(expected.pitch, 10);
    }
    // Mid-march the grid straddles the fold: one chevron visibly bending
    // over the edge — sunk and pitched together, one bend, not a sink…
    expect(chevrons.some((c) => c.position.y < -0.05 && c.rotation.x < -0.3)).toBe(true);
    // …while the rest still ride flat on the deck.
    expect(chevrons.some((c) => c.position.y === 0 && c.rotation.x === 0)).toBe(true);
  });

  it("a belt riding a Moving Segment parents under its group, in its local frame", () => {
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
    const [strip] = buildConveyorStrips([BELT], [carrier]);
    expect(strip!.movingIndex).toBe(0);

    // Composes back to the world rest frame under the carrier's own placement —
    // the same local-frame contract the carrier's box visuals keep.
    const group = new THREE.Group();
    group.position.set(carrier.position.x, carrier.position.y, carrier.position.z);
    group.quaternion.set(carrier.orientation.x, carrier.orientation.y, carrier.orientation.z, carrier.orientation.w);
    group.add(strip!.object);
    group.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    strip!.object.getWorldPosition(world);
    expect(world.x).toBeCloseTo(10, 9);
    expect(world.z).toBeCloseTo(5, 9);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(strip!.object.getWorldQuaternion(new THREE.Quaternion()));
    expect(forward.z).toBeCloseTo(-1, 9);
  });
});
