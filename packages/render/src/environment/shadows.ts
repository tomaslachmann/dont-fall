import type { Vec3 } from "@dont-fall/shared";
import * as THREE from "three";

// Real shadow maps from the Environment's sun (ADR 0074). Every number here is
// a starting point for tuning with the user (acne, peter-panning, shimmer, cost).

/** Texels per side of the shadow map. 2048² ≈ 16 MiB of colour plus depth (research §6). */
export const SHADOW_MAP_SIZE = 2048;
/**
 * Half the side of the square the shadow camera covers around its focus, in
 * world units. Nothing outside it casts or receives; at 2048 texels each texel
 * is about 3.4 cm across.
 */
export const SHADOW_BOX_HALF_EXTENT = 35;
/**
 * How far along the light the shadow camera stands from its focus. Anything
 * between it and the focus, and as far again beyond, can cast: a tall piece
 * behind the focus still reaches it, and a low sunset sun's long shadows fit.
 */
export const SHADOW_LIGHT_DISTANCE = 60;
/** Depth offset against shadow acne on surfaces facing the light. */
export const SHADOW_BIAS = -0.0005;
/** Offset along the surface normal, against acne on surfaces the light grazes. */
export const SHADOW_NORMAL_BIAS = 0.02;
/** Soft percentage-closer filtering: the edge of a Character's shadow never looks jagged. */
export const SHADOW_MAP_TYPE: THREE.ShadowMapType = THREE.PCFSoftShadowMap;

/** World units per texel of a `mapSize`² shadow map over the box. */
export const shadowTexelSize = (mapSize: number): number => (SHADOW_BOX_HALF_EXTENT * 2) / mapSize;

/** World units per shadow-map texel, at the default map size. */
export const SHADOW_TEXEL_SIZE = shadowTexelSize(SHADOW_MAP_SIZE);

/**
 * How the sun's shadow is drawn: a graphics quality level's choice (ADR
 * 0079). The box, the biases and the light distance stay the same at every
 * level; only the map's resolution and its filter change.
 */
export interface SunShadowSettings {
  mapSize: number;
  type: THREE.ShadowMapType;
}

/** ADR 0074's shadows, as M12 shipped them: the `high` level. */
export const DEFAULT_SUN_SHADOW: SunShadowSettings = { mapSize: SHADOW_MAP_SIZE, type: SHADOW_MAP_TYPE };

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * The two axes a shadow camera looking back along `lightDirection` (toward the
 * light) spans its map with: the same right and up `Matrix4.lookAt` builds for
 * it, so rounding along them is rounding to its texels.
 */
const lightAxes = (lightDirection: Vec3): { right: THREE.Vector3; up: THREE.Vector3; back: THREE.Vector3 } => {
  const back = new THREE.Vector3(lightDirection.x, lightDirection.y, lightDirection.z).normalize();
  // A light straight overhead: `lookAt` nudges it off the up axis the same way.
  if (Math.abs(Math.abs(back.dot(WORLD_UP)) - 1) < 1e-12) back.set(back.x, back.y, back.z + 0.0001).normalize();
  const right = new THREE.Vector3().crossVectors(WORLD_UP, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  return { right, up, back };
};

/**
 * `point` moved by less than one texel across the shadow map, onto the texel
 * grid of a shadow camera looking along `lightDirection`. A box that follows a
 * moving focus without this slides by fractions of a texel each frame, and
 * every shadow edge crawls; snapped, it moves in whole texels, and the edges
 * stay still. Movement along the light itself changes nothing on the map and
 * is kept.
 */
export const snapToShadowTexels = (point: Vec3, lightDirection: Vec3, texelSize: number): Vec3 => {
  const { right, up, back } = lightAxes(lightDirection);
  const p = new THREE.Vector3(point.x, point.y, point.z);
  const snapped = new THREE.Vector3()
    .addScaledVector(right, Math.round(p.dot(right) / texelSize) * texelSize)
    .addScaledVector(up, Math.round(p.dot(up) / texelSize) * texelSize)
    .addScaledVector(back, p.dot(back));
  return { x: snapped.x, y: snapped.y, z: snapped.z };
};

/** Makes `sun` cast, with the box and biases above and a `mapSize`² map. */
export const castSunShadow = (sun: THREE.DirectionalLight, mapSize = SHADOW_MAP_SIZE): void => {
  sun.castShadow = true;
  const { shadow } = sun;
  shadow.mapSize.set(mapSize, mapSize);
  shadow.bias = SHADOW_BIAS;
  shadow.normalBias = SHADOW_NORMAL_BIAS;
  const camera = shadow.camera;
  camera.left = -SHADOW_BOX_HALF_EXTENT;
  camera.right = SHADOW_BOX_HALF_EXTENT;
  camera.top = SHADOW_BOX_HALF_EXTENT;
  camera.bottom = -SHADOW_BOX_HALF_EXTENT;
  camera.near = 0.5;
  camera.far = SHADOW_LIGHT_DISTANCE * 2;
  camera.updateProjectionMatrix();
};
