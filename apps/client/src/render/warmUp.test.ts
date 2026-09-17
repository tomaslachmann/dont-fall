import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { warmUpStage, type WarmUpRenderer } from "./warmUp.js";

const world = () => {
  const scene = new THREE.Scene();
  const far = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const alwaysDrawn = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  alwaysDrawn.frustumCulled = false;
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  hidden.visible = false;
  scene.add(far, alwaysDrawn, hidden);
  return { scene, far, alwaysDrawn, hidden, camera: new THREE.PerspectiveCamera() };
};

const recordingRenderer = (log: string[]): WarmUpRenderer => ({
  compile: (scene, camera) => log.push(`compile ${scene.type} ${camera.type}`),
  setRenderTarget: () => log.push("target screen"),
  clear: () => log.push("clear"),
});

describe("warmUpStage (M13 ticket 06)", () => {
  it("compiles, renders one frame with nothing culled, then clears that frame away", () => {
    const { scene, far, alwaysDrawn, hidden, camera } = world();
    const log: string[] = [];
    let culledDuringFrame: boolean[] = [];
    warmUpStage(recordingRenderer(log), scene, camera, () => {
      log.push("frame");
      culledDuringFrame = [far.frustumCulled, alwaysDrawn.frustumCulled, hidden.frustumCulled];
    });

    expect(log).toEqual(["compile Scene PerspectiveCamera", "frame", "target screen", "clear"]);
    expect(culledDuringFrame).toEqual([false, false, false]);
    // Put back exactly as found: only what was culled before is culled again.
    expect([far.frustumCulled, alwaysDrawn.frustumCulled, hidden.frustumCulled]).toEqual([true, false, true]);
    // Visibility is never touched: the frame draws what the Round would draw.
    expect(hidden.visible).toBe(false);
  });

  it("restores culling when the frame throws", () => {
    const { scene, far, camera } = world();
    expect(() =>
      warmUpStage(recordingRenderer([]), scene, camera, () => {
        throw new Error("context lost");
      }),
    ).toThrow("context lost");
    expect(far.frustumCulled).toBe(true);
  });
});
