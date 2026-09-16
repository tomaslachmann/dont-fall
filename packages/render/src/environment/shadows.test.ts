import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  SHADOW_BIAS,
  SHADOW_BOX_HALF_EXTENT,
  SHADOW_LIGHT_DISTANCE,
  SHADOW_MAP_SIZE,
  SHADOW_NORMAL_BIAS,
  SHADOW_TEXEL_SIZE,
  castSunShadow,
  snapToShadowTexels,
} from "./shadows.js";

const LIGHT = { x: 0.5, y: 0.8, z: 0.3 };
const TEXEL = 0.25;

/** Where `point` lands on the map of a shadow camera placed the way the Environment places it. */
const onMap = (point: { x: number; y: number; z: number }, lightDirection: typeof LIGHT, focus: { x: number; y: number; z: number }): THREE.Vector2 => {
  const camera = new THREE.OrthographicCamera();
  const direction = new THREE.Vector3(lightDirection.x, lightDirection.y, lightDirection.z).normalize();
  camera.position.set(focus.x, focus.y, focus.z).addScaledVector(direction, SHADOW_LIGHT_DISTANCE);
  camera.lookAt(focus.x, focus.y, focus.z);
  camera.updateMatrixWorld();
  const view = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(camera.matrixWorldInverse);
  return new THREE.Vector2(view.x, view.y);
};

const isWhole = (value: number): boolean => Math.abs(value - Math.round(value)) < 1e-6;

describe("snapToShadowTexels", () => {
  it("puts the shadow camera on its own texel grid, so a fixed point in the world stays on a texel boundary", () => {
    const worldPoint = { x: 3, y: 1, z: -2 };
    const reference = onMap(worldPoint, LIGHT, snapToShadowTexels({ x: 0, y: 0, z: 0 }, LIGHT, TEXEL));

    for (const focus of [
      { x: 0.37, y: 0.11, z: -0.52 },
      { x: 12.9, y: -3.3, z: 40.01 },
      { x: -7.77, y: 2.5, z: 0.06 },
    ]) {
      const shifted = onMap(worldPoint, LIGHT, snapToShadowTexels(focus, LIGHT, TEXEL));
      // The world point moved across the map by whole texels only.
      expect(isWhole((shifted.x - reference.x) / TEXEL)).toBe(true);
      expect(isWhole((shifted.y - reference.y) / TEXEL)).toBe(true);
    }
  });

  it("moves the point by at most half a texel across the map, and not at all along the light", () => {
    const point = { x: 5.13, y: 2.04, z: -9.9 };
    const snapped = snapToShadowTexels(point, LIGHT, TEXEL);
    const shift = new THREE.Vector3(snapped.x - point.x, snapped.y - point.y, snapped.z - point.z);
    const light = new THREE.Vector3(LIGHT.x, LIGHT.y, LIGHT.z).normalize();

    expect(Math.abs(shift.dot(light))).toBeLessThan(1e-9);
    expect(shift.length()).toBeLessThanOrEqual(Math.SQRT1_2 * TEXEL + 1e-9);
  });

  it("holds the map still while the focus moves within one texel, or anywhere along the light", () => {
    const origin = { x: 0, y: 0, z: 0 };
    const at = snapToShadowTexels({ x: 1, y: 0, z: 1 }, LIGHT, TEXEL);
    const light = new THREE.Vector3(LIGHT.x, LIGHT.y, LIGHT.z).normalize();
    // A tenth of a texel across, and a long way along the light.
    const moved = new THREE.Vector3(at.x, at.y, at.z).add(new THREE.Vector3(0.1 * TEXEL, 0, 0)).addScaledVector(light, 7);
    const again = snapToShadowTexels(moved, LIGHT, TEXEL);

    // Measured on one fixed map, so only movement across it counts.
    const before = onMap(at, LIGHT, origin);
    const after = onMap(again, LIGHT, origin);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("copes with a light straight overhead", () => {
    const snapped = snapToShadowTexels({ x: 0.3, y: 1, z: 0.6 }, { x: 0, y: 1, z: 0 }, TEXEL);
    expect([snapped.x, snapped.y, snapped.z].every(Number.isFinite)).toBe(true);
  });
});

describe("castSunShadow", () => {
  it("makes the sun cast over the shadow box, at the map size and biases above", () => {
    const sun = new THREE.DirectionalLight();
    castSunShadow(sun);
    const camera = sun.shadow.camera;

    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.toArray()).toEqual([SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]);
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([
      -SHADOW_BOX_HALF_EXTENT,
      SHADOW_BOX_HALF_EXTENT,
      SHADOW_BOX_HALF_EXTENT,
      -SHADOW_BOX_HALF_EXTENT,
    ]);
    expect(camera.far).toBeGreaterThan(SHADOW_LIGHT_DISTANCE);
    expect(sun.shadow.bias).toBe(SHADOW_BIAS);
    expect(sun.shadow.normalBias).toBe(SHADOW_NORMAL_BIAS);
  });

  it("uses a texel size that divides the box into the map exactly", () => {
    expect((SHADOW_BOX_HALF_EXTENT * 2) / SHADOW_TEXEL_SIZE).toBe(SHADOW_MAP_SIZE);
  });
});
