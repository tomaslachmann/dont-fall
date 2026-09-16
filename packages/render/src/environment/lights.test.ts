import { ENVIRONMENT_PRESETS, sunDirection, sunLightDirection, type EnvironmentPreset } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createEnvironmentLights } from "./lights.js";
import { SHADOW_LIGHT_DISTANCE } from "./shadows.js";

const DAY = ENVIRONMENT_PRESETS.day;

const lightDirection = (sun: THREE.DirectionalLight): THREE.Vector3 =>
  sun.position.clone().sub(sun.target.position).normalize();

describe("createEnvironmentLights", () => {
  it("colours the hemisphere from the preset, its ground from the cloud floor's shade", () => {
    const { hemisphere } = createEnvironmentLights(DAY);

    expect(hemisphere.color.getHex()).toBe(DAY.light.hemiSky);
    expect(hemisphere.groundColor.getHex()).toBe(DAY.cloudFloor.shade);
    expect(hemisphere.intensity).toBe(DAY.light.hemiIntensity);
  });

  it("lights from where the drawn sun is, at the preset's colour and strength", () => {
    const { sun } = createEnvironmentLights(DAY);
    const expected = sunDirection(DAY);
    const direction = lightDirection(sun);

    expect(sun.color.getHex()).toBe(DAY.light.sunColor);
    expect(sun.intensity).toBe(DAY.light.sunIntensity);
    expect(direction.x).toBeCloseTo(expected.x, 10);
    expect(direction.y).toBeCloseTo(expected.y, 10);
    expect(direction.z).toBeCloseTo(expected.z, 10);
    expect(sun.position.distanceTo(sun.target.position)).toBeCloseTo(SHADOW_LIGHT_DISTANCE, 10);
  });

  it("lifts the light above a low drawn sun when the preset names lightElevationDeg", () => {
    const lowSun: EnvironmentPreset = {
      ...DAY,
      sky: { ...DAY.sky, sun: { ...DAY.sky.sun, elevationDeg: 8 } },
      light: { ...DAY.light, lightElevationDeg: 35 },
    };
    const direction = lightDirection(createEnvironmentLights(lowSun).sun);
    const expected = sunLightDirection(lowSun);

    expect(direction.y).toBeCloseTo(expected.y, 10);
    expect(direction.y).toBeGreaterThan(sunDirection(lowSun).y);
  });

  it("casts no shadow by itself: createEnvironment decides", () => {
    expect(createEnvironmentLights(DAY).sun.castShadow).toBe(false);
  });
});
