import * as THREE from "three";

/**
 * Which Part of an Asset a node belongs to (ADR 0116) — `GLTFLoader` puts
 * each glTF node's `extras` on its `userData`, so the `part` the converter
 * stamped is read here exactly as `role` already is. Absent on every node of
 * an Asset that is one rigid piece.
 */
export const partOf = (node: THREE.Object3D): string | undefined => node.userData.part as string | undefined;

/**
 * A clone of `template` holding only the Parts `wanted` accepts, with every
 * node's place in the Asset's frame intact.
 *
 * A node the predicate rejects is dropped, but its *transform* survives as an
 * empty node whenever something below it is kept — otherwise a nested Part
 * (a cannon's barrel inside its carriage) would be re-seated at the Asset's
 * origin the moment its parent was dropped. Geometry and materials are
 * shared with the template, as `clone` always shares them.
 */
export const assetPartSubtree = (template: THREE.Object3D, wanted: (part: string | undefined) => boolean): THREE.Object3D => {
  const build = (node: THREE.Object3D): THREE.Object3D | null => {
    const self = wanted(partOf(node));
    const kept = node.children.flatMap((child) => build(child) ?? []);
    if (!self && kept.length === 0) return null;
    let copy: THREE.Object3D;
    if (self) {
      copy = node.clone(false);
    } else {
      copy = new THREE.Object3D();
      copy.name = node.name;
      copy.position.copy(node.position);
      copy.quaternion.copy(node.quaternion);
      copy.scale.copy(node.scale);
    }
    for (const child of kept) copy.add(child);
    return copy;
  };
  return build(template) ?? new THREE.Group();
};
