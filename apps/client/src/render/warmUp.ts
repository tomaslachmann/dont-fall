import type * as THREE from "three";

/** The parts of `WebGLRenderer` a warm-up needs, so it can be tested without WebGL. */
export interface WarmUpRenderer {
  compile: (scene: THREE.Object3D, camera: THREE.Camera) => unknown;
  setRenderTarget: (target: null) => void;
  clear: () => void;
}

/**
 * Do the first-sight work before the Round, not during it (M13 ticket 06).
 * The before numbers put frames of 183–292 ms in the first metres, and a
 * 93 ms one where a new section first came into view.
 *
 * 1. Every material's program starts compiling (`compile`), hidden objects
 *    included. Where the driver has `KHR_parallel_shader_compile`, that work
 *    runs in parallel until the frame below needs it.
 * 2. One whole frame renders with nothing frustum-culled. Every geometry and
 *    texture reaches the GPU, and the passes `compile` does not know about
 *    compile too: the shadow map's depth materials and the composer's.
 * 3. The canvas is cleared, so that frame, taken from wherever the camera
 *    happens to be, is never shown.
 *
 * Synchronous on purpose. `compileAsync` polls on a timer that throws once
 * its renderer is disposed, which a Stage torn down mid-warm-up would hit.
 * A warm-up only runs while loading, where a blocked main thread shows
 * nothing anyway. Culling flags are put back even if the frame throws.
 */
export const warmUpStage = (
  renderer: WarmUpRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  renderFrame: () => void,
): void => {
  renderer.compile(scene, camera);
  const culled: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (!object.frustumCulled) return;
    object.frustumCulled = false;
    culled.push(object);
  });
  try {
    renderFrame();
  } finally {
    for (const object of culled) object.frustumCulled = true;
  }
  renderer.setRenderTarget(null);
  renderer.clear();
};
