import * as THREE from "three";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import { describe, expect, it, vi } from "vitest";
import { COMPOSER_SAMPLES, createSceneComposer } from "./speedLines.js";

// jsdom has no WebGL; building and sizing a composer only asks the renderer for its size.
const fakeRenderer = (width: number, height: number, pixelRatio: number): THREE.WebGLRenderer =>
  ({
    getSize: (target: THREE.Vector2) => target.set(width, height),
    getPixelRatio: () => pixelRatio,
  }) as unknown as THREE.WebGLRenderer;

describe("createSceneComposer", () => {
  it("draws the scene into multisampled half-float buffers, so the Round is antialiased", () => {
    const composer = createSceneComposer(fakeRenderer(800, 600, 1));

    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      expect(target.samples).toBe(COMPOSER_SAMPLES);
      expect(target.texture.type).toBe(THREE.HalfFloatType);
    }
  });

  it("sizes its buffers to the drawing buffer, pixel ratio included, and keeps doing so on resize", () => {
    const composer = createSceneComposer(fakeRenderer(800, 600, 2));
    expect([composer.renderTarget1.width, composer.renderTarget1.height]).toEqual([1600, 1200]);

    composer.setSize(1000, 500);
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      expect([target.width, target.height]).toEqual([2000, 1000]);
    }
  });

  it("sizes an added pass once, to the drawing buffer, not the pixel ratio squared", () => {
    const composer = createSceneComposer(fakeRenderer(800, 600, 2));
    const setSize = vi.fn();

    composer.addPass({ setSize } as unknown as Pass);

    expect(setSize).toHaveBeenCalledWith(1600, 1200);
  });

  it("frees both multisampled buffers with the composer", () => {
    const composer = createSceneComposer(fakeRenderer(800, 600, 1));
    const freed = [vi.spyOn(composer.renderTarget1, "dispose"), vi.spyOn(composer.renderTarget2, "dispose")];

    composer.dispose();

    for (const spy of freed) expect(spy).toHaveBeenCalledOnce();
  });
});
