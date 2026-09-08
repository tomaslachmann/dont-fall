import * as THREE from "three";

/**
 * Release every GPU resource reachable from `root`. Three.js uploads
 * geometries, materials and textures to the GPU and holds them there until
 * `dispose` is called explicitly — dropping the JS reference frees nothing.
 *
 * Extracted from `scene.ts` (M6 ticket 02) so a real remote Character's
 * pooled, cloned rig (ADR 0046) can be torn down identically to the local
 * Character's own scene graph, on disconnect as well as on `dispose`.
 */
export const disposeSceneGraph = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh> & Partial<THREE.SkinnedMesh>;
    mesh.geometry?.dispose();
    mesh.skeleton?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      // A material's textures hang off it under names that vary by material
      // type (`map`, `normalMap`, `emissiveMap`, …) — walking its own values
      // catches them all without enumerating each type's slots.
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
};
