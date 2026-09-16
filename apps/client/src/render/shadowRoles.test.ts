import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { setShadowRole } from "./shadowRoles.js";

const nested = (): { root: THREE.Group; meshes: THREE.Mesh[]; group: THREE.Group } => {
  const root = new THREE.Group();
  const group = new THREE.Group();
  const meshes = [new THREE.Mesh(), new THREE.SkinnedMesh()];
  root.add(meshes[0]!, group);
  group.add(meshes[1]!);
  return { root, meshes, group };
};

describe("setShadowRole", () => {
  it.each([
    ["caster", true, false],
    ["receiver", false, true],
    ["both", true, true],
  ] as const)("marks every mesh, however deep, as a %s", (role, cast, receive) => {
    const { root, meshes } = nested();
    expect(setShadowRole(root, role)).toBe(root);
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(cast);
      expect(mesh.receiveShadow).toBe(receive);
    }
  });

  it("leaves what is not a mesh alone", () => {
    const { root, group } = nested();
    setShadowRole(root, "both");
    expect(group.castShadow).toBe(false);
    expect(root.receiveShadow).toBe(false);
  });

  it("carries through a clone, so a remote rig cloned from a marked model casts too", () => {
    const { root } = nested();
    setShadowRole(root, "caster");
    root.clone(true).traverse((object) => {
      if ((object as THREE.Mesh).isMesh) expect(object.castShadow).toBe(true);
    });
  });
});
