import type { EnvironmentPreset } from "@dont-fall/shared";
import * as THREE from "three";
import { createSkyDome } from "./skyDome.js";

/**
 * Bakes `preset`'s sky into a prefiltered environment map for
 * `scene.environment` (ADR 0074, research §6), so glossy Assets and BLIP
 * reflect the sky they are drawn under and take their indirect light in its
 * colours. The caller owns the returned target (≈ 6 MiB, research §8) and
 * frees it with `dispose()`; `disposeSceneGraph` never reaches it.
 *
 * The bake renders a scene of its own holding only a dome made from the same
 * preset, never the scene being drawn, and frees that dome when it is done. A
 * fresh `PMREMGenerator` per bake, disposed before returning: disposing one
 * generator makes the others unusable, and a module-level one would outlive a
 * Vite hot update with its uploads still alive (research §8).
 */
export const bakeEnvironmentMap = (renderer: THREE.WebGLRenderer, preset: EnvironmentPreset): THREE.WebGLRenderTarget => {
  const dome = createSkyDome(preset);
  // The dome is all this scene holds, so there is nothing to test depth
  // against, and its depth sits exactly on the far plane: nothing is left
  // depending on how the bake target's fresh depth buffer starts out.
  dome.material.depthTest = false;
  const bakeScene = new THREE.Scene();
  bakeScene.add(dome);

  const generator = new THREE.PMREMGenerator(renderer);
  try {
    // The cube camera sits at the origin, inside the unit dome, and the
    // generator bakes with no tone mapping into a linear half-float target:
    // the dome's own tone-mapping and colour-space includes compile to
    // nothing, so the map holds the sky's linear colours.
    return generator.fromScene(bakeScene);
  } finally {
    generator.dispose();
    dome.geometry.dispose();
    dome.material.dispose();
  }
};
