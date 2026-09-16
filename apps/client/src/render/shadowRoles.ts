import * as THREE from "three";

/**
 * What a drawn thing does in the Environment's real shadows (ADR 0074):
 * `caster` throws one (a Character), `receiver` shows others' (a deck sheet,
 * a Conveyor strip), `both` does both (Track pieces, which shadow the pieces
 * below them).
 */
export type ShadowRole = "caster" | "receiver" | "both";

/** Marks every mesh under `root` (itself included) with `role`, and returns `root`. */
export const setShadowRole = <T extends THREE.Object3D>(root: T, role: ShadowRole): T => {
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    object.castShadow = role !== "receiver";
    object.receiveShadow = role !== "caster";
  });
  return root;
};
