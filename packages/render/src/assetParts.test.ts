import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assetPartSubtree, partOf } from "./assetParts.js";

/** A node tree shaped like a converted Asset: parts stamped on `userData`, transforms that matter. */
const asset = (): THREE.Object3D => {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  base.name = "base";
  base.userData.part = "base";
  const carriage = new THREE.Group();
  carriage.name = "carriage";
  carriage.userData.part = "carriage";
  carriage.position.set(0, 2, 0);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  barrel.name = "barrel";
  barrel.userData.part = "barrel";
  barrel.position.set(0, 1, 0);
  carriage.add(barrel);
  root.add(base, carriage);
  return root;
};

const names = (root: THREE.Object3D): string[] => {
  const found: string[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) found.push(node.name);
  });
  return found.sort();
};

describe("assetPartSubtree (ADR 0116)", () => {
  it("keeps only the Part asked for", () => {
    expect(names(assetPartSubtree(asset(), (part) => part === "base"))).toEqual(["base"]);
    expect(names(assetPartSubtree(asset(), (part) => part === "barrel"))).toEqual(["barrel"]);
  });

  it("keeps a nested Part where it stands, not at the Asset's origin", () => {
    const only = assetPartSubtree(asset(), (part) => part === "barrel");
    only.updateMatrixWorld(true);
    const barrel = only.getObjectByName("barrel")!;

    // 2 from the dropped carriage it hangs under, 1 of its own: a Part that
    // loses its parent must not lose its parent's transform with it.
    expect(barrel.getWorldPosition(new THREE.Vector3()).y).toBe(3);
  });

  it("drops a rejected Part's own mesh while keeping it as a frame for what is kept", () => {
    const only = assetPartSubtree(asset(), (part) => part === "barrel");

    expect(names(only)).toEqual(["barrel"]);
    expect(only.getObjectByName("carriage")).toBeDefined();
  });

  it("keeps everything but the named Parts, for the half drawn standing still", () => {
    const moving = new Set(["carriage", "barrel"]);
    const still = assetPartSubtree(asset(), (part) => part === undefined || !moving.has(part));

    expect(names(still)).toEqual(["base"]);
  });

  it("shares geometry and materials with the template, as a clone does", () => {
    const template = asset();
    const only = assetPartSubtree(template, (part) => part === "base");

    expect((only.getObjectByName("base") as THREE.Mesh).geometry).toBe((template.getObjectByName("base") as THREE.Mesh).geometry);
  });

  it("answers an empty group when no Part matches", () => {
    expect(names(assetPartSubtree(asset(), (part) => part === "nothing"))).toEqual([]);
  });

  it("reads the part a node was stamped with", () => {
    expect(partOf(asset().getObjectByName("base")!)).toBe("base");
    expect(partOf(new THREE.Group())).toBeUndefined();
  });
});
