import { readFileSync } from "node:fs";
import * as path from "node:path";
import { MODULE_LIBRARY, type Segment } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { builderLibrary, loadAssetVisuals } from "./assets.js";
import { applySegmentTransform, buildModuleGroup, buildSegmentGroup, disposeGroup } from "./render.js";

const assetsRoot = path.resolve(import.meta.dirname, "../../../assets");
const realFetch = async (url: string): Promise<Uint8Array> => {
  const fileName = url.substring(url.lastIndexOf("/") + 1);
  return new Uint8Array(readFileSync(path.join(assetsRoot, fileName)));
};

const meshCount = (root: THREE.Object3D): number => {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
};

const rolesPresent = (root: THREE.Object3D): unknown[] => {
  const roles: unknown[] = [];
  root.traverse((object) => {
    if (object.userData.role !== undefined) roles.push(object.userData.role);
  });
  return roles;
};

describe("buildSegmentGroup", () => {
  it("renders an asset Segment's visual mesh and no collision geometry", async () => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", ["corner_lshape"]);
    const segment: Segment = { moduleId: "corner_lshape", position: { x: 10, y: 1, z: -3 }, rotation: Math.PI / 2 };

    const group = buildSegmentGroup({ ...MODULE_LIBRARY, corner_lshape: MODULE_LIBRARY.start! }, segment, templates)!;

    expect(group).toBeDefined();
    expect(rolesPresent(group)).not.toContain("collision");
    expect(meshCount(group)).toBeGreaterThan(0);
    // Positioned exactly as the Segment places it — the same single helper
    // the box path uses, never separate positioning code.
    expect(group.position.toArray()).toEqual([10, 1, -3]);
    const expected = new THREE.Group();
    applySegmentTransform(expected, segment);
    expect(group.quaternion.toArray()).toEqual(expected.quaternion.toArray());
  });

  it("leaves the template untouched — clones render, templates stay cached", async () => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", ["platform_straight"]);
    const segment: Segment = { moduleId: "platform_straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

    buildSegmentGroup({}, segment, templates)!;

    expect(templates["platform_straight"]!.parent).toBeNull();
    expect(meshCount(templates["platform_straight"]!)).toBe(1);
  });

  it("draws procedural Segments from boxes exactly as before", () => {
    const segment: Segment = { moduleId: "start", position: { x: 1, y: 2, z: 3 }, rotation: 0 };

    const group = buildSegmentGroup(MODULE_LIBRARY, segment)!;
    const boxes = buildModuleGroup(MODULE_LIBRARY.start!);

    expect(meshCount(group)).toBe(meshCount(boxes));
    expect(group.position.toArray()).toEqual([1, 2, 3]);
    disposeGroup(boxes);
  });

  it("returns undefined for an unknown Module — the viewport skips it as before", () => {
    const segment: Segment = { moduleId: "ghost", position: { x: 0, y: 0, z: 0 }, rotation: 0 };

    expect(buildSegmentGroup(MODULE_LIBRARY, segment)).toBeUndefined();
  });
});

describe("removing an asset Segment (the builder's allocate-then-free discipline)", () => {
  it("frees the Segment's meshes and leaves nothing behind", async () => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", ["platform_straight"]);
    const parent = new THREE.Group();
    const group = buildSegmentGroup(builderLibrary(), { moduleId: "platform_straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }, templates)!;
    parent.add(group);
    const geometries = new Set<THREE.BufferGeometry>();
    group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) geometries.add((object as THREE.Mesh).geometry);
    });
    expect(geometries.size).toBeGreaterThan(0);
    const spies = [...geometries].map((geometry) => vi.spyOn(geometry, "dispose"));

    // What `setTrack` does on every rebuild: dispose, then detach.
    disposeGroup(group);
    parent.remove(group);

    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
  });
});
