import { cloudFloorY, sunLightDirection, type EnvironmentPreset, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { createCloudFloor } from "./cloudFloor.js";
import { createCloudPuffs } from "./cloudPuffs.js";
import { bakeEnvironmentMap } from "./environmentMap.js";
import { createEnvironmentLights } from "./lights.js";
import { SHADOW_LIGHT_DISTANCE, SHADOW_MAP_TYPE, SHADOW_TEXEL_SIZE, castSunShadow, snapToShadowTexels } from "./shadows.js";
import { createSkyDome } from "./skyDome.js";
import { createStars } from "./stars.js";

/** The name of the one Group everything an Environment draws hangs under. */
export const ENVIRONMENT_ROOT_NAME = "environment";

export interface EnvironmentOptions {
  /** The simulation's kill height, which the cloud floor is placed from. */
  killPlaneY: number;
  /**
   * The lowest Y the Track's drawn geometry reaches, which the cloud floor
   * stays under (`cloudFloorY`); `Infinity` for a Track with nothing drawn.
   * `lowestDrawnY` and `lowestMovingY` measure it.
   */
  lowestSegmentY: number;
  /**
   * Whether the preset's fog is drawn: on for the game's chase camera, off
   * for the builder's orbit camera, which frames a whole Track from far
   * outside the fog's distances (research §5).
   */
  fog: boolean;
  /** `"low"` skips the cloud puffs; the sky, floor, fog and light stay. */
  detail: "full" | "low";
  /**
   * Whether the sun casts real shadow maps (ADR 0074). The Environment's own
   * meshes never cast or receive; what does is the caller's to mark.
   */
  shadows: boolean;
}

export interface Environment {
  /**
   * Once per rendered frame, after the camera is placed, with the wall clock
   * (never sim time — an Environment never affects play). Moves only what
   * follows the camera or drifts, and the shadow box: it centres on
   * `shadowFocus` (the game's local Character), or on the camera without one.
   */
  update(camera: THREE.Camera, nowMs: number, shadowFocus?: Vec3): void;
  /**
   * Removes everything this Environment added to the scene and frees it,
   * baked environment map included, and puts back the scene's fog and
   * environment map and the renderer's exposure as they were. Idempotent.
   */
  dispose(): void;
}

/**
 * Draws `preset` into `scene` (ADR 0074), for the game's Stage and the Track
 * builder's preview alike. Everything it adds hangs under one Group, so its
 * lifetime is one `add` and one `remove`, and none of it is ever a camera
 * collidable. It is created and disposed with its scene; nothing survives a
 * Track swap.
 *
 * It owns the preset's exposure (`toneMappingExposure`), never the operator:
 * the tone-mapping operator is each app's renderer setting. It also owns
 * `scene.environment`: `renderer` bakes the sky into it once, here.
 *
 * `options.detail: "low"` leaves out the puffs; the sky, cloud floor, fog,
 * light and environment map carry the look on their own (research §8).
 */
export const createEnvironment = (
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  preset: EnvironmentPreset,
  options: EnvironmentOptions,
): Environment => {
  // Baked first, so a bake that throws leaves the scene untouched.
  const environmentMap = bakeEnvironmentMap(renderer, preset);

  const root = new THREE.Group();
  root.name = ENVIRONMENT_ROOT_NAME;

  const sky = createSkyDome(preset);
  // Kept at low detail too: a few hundred points cost next to nothing (research §8).
  const stars = preset.sky.stars && preset.sky.stars.count > 0 ? createStars(preset.sky.stars) : null;
  const floorY = cloudFloorY(preset, options.killPlaneY, options.lowestSegmentY);
  const floor = createCloudFloor(preset, floorY);
  const puffs = options.detail === "full" && preset.puffs.count > 0 ? createCloudPuffs(preset, floorY) : null;
  const lights = createEnvironmentLights(preset);
  // The target joins the root too: a directional light aims at its target's
  // world matrix, which nothing updates for an object outside the scene.
  root.add(sky, floor.mesh, lights.hemisphere, lights.sun, lights.sun.target);
  if (puffs) root.add(puffs.group);
  if (stars) root.add(stars);

  const toLight = sunLightDirection(preset);
  const previousShadowMap = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type };
  if (options.shadows) {
    castSunShadow(lights.sun);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = SHADOW_MAP_TYPE;
  }
  scene.add(root);

  const previousFog = scene.fog;
  // Fog's colour is always the horizon stop, so a fogged platform dissolves
  // into the sky rather than into a grey wall (research §5).
  const fog = options.fog ? new THREE.Fog(preset.sky.horizon, preset.fog.near, preset.fog.far) : null;
  scene.fog = fog;

  const previousEnvironment = scene.environment;
  const previousEnvironmentIntensity = scene.environmentIntensity;
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = preset.light.environmentIntensity;

  const previousExposure = renderer.toneMappingExposure;
  renderer.toneMappingExposure = preset.exposure;

  const cameraPosition = new THREE.Vector3();
  let disposed = false;
  return {
    update: (camera, nowMs, shadowFocus) => {
      if (disposed) return;
      camera.getWorldPosition(cameraPosition);
      sky.position.copy(cameraPosition);
      stars?.position.copy(cameraPosition);
      floor.update(cameraPosition, nowMs);
      puffs?.update(cameraPosition, nowMs);
      // The box moves in whole shadow-map texels, so shadow edges never crawl.
      const focus = snapToShadowTexels(shadowFocus ?? cameraPosition, toLight, SHADOW_TEXEL_SIZE);
      lights.sun.target.position.set(focus.x, focus.y, focus.z);
      lights.sun.position.set(
        focus.x + toLight.x * SHADOW_LIGHT_DISTANCE,
        focus.y + toLight.y * SHADOW_LIGHT_DISTANCE,
        focus.z + toLight.z * SHADOW_LIGHT_DISTANCE,
      );
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      sky.geometry.dispose();
      sky.material.dispose();
      stars?.geometry.dispose();
      stars?.material.dispose();
      floor.dispose();
      puffs?.dispose();
      lights.hemisphere.dispose();
      // Frees the sun's shadow map too (`LightShadow.dispose`).
      lights.sun.dispose();
      environmentMap.dispose();
      // Only undo what is still ours — something else may have replaced them since.
      if (scene.fog === fog) scene.fog = previousFog;
      if (scene.environment === environmentMap.texture) {
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousEnvironmentIntensity;
      }
      if (renderer.toneMappingExposure === preset.exposure) renderer.toneMappingExposure = previousExposure;
      if (options.shadows && renderer.shadowMap.enabled && renderer.shadowMap.type === SHADOW_MAP_TYPE) {
        renderer.shadowMap.enabled = previousShadowMap.enabled;
        renderer.shadowMap.type = previousShadowMap.type;
      }
    },
  };
};
