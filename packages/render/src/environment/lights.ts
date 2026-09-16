import { sunLightDirection, type EnvironmentPreset } from "@dont-fall/shared";
import * as THREE from "three";
import { SHADOW_LIGHT_DISTANCE } from "./shadows.js";

export interface EnvironmentLights {
  hemisphere: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
}

/**
 * The preset's light (ADR 0074, research §6): a hemisphere light whose ground
 * colour is the cloud floor's shade, since the light bouncing up onto the
 * undersides of platforms comes off the clouds, and one sun whose direction is
 * the drawn sun's (or the preset's named `lightElevationDeg`), so the light
 * comes from where the disc is. It stands {@link SHADOW_LIGHT_DISTANCE} from
 * its target, which starts at the world origin; `createEnvironment` moves both
 * with the shadow's focus, and decides whether the sun casts.
 */
export const createEnvironmentLights = (preset: EnvironmentPreset): EnvironmentLights => {
  const { light } = preset;
  const hemisphere = new THREE.HemisphereLight(light.hemiSky, preset.cloudFloor.shade, light.hemiIntensity);
  hemisphere.name = "environment-hemisphere";

  const sun = new THREE.DirectionalLight(light.sunColor, light.sunIntensity);
  sun.name = "environment-sun";
  const direction = sunLightDirection(preset);
  sun.position.set(direction.x, direction.y, direction.z).multiplyScalar(SHADOW_LIGHT_DISTANCE);
  sun.target.name = "environment-sun-target";

  return { hemisphere, sun };
};
