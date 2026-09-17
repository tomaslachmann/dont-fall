import { ENVIRONMENT_PRESETS } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_FLOOR_FADE_START,
  CLOUD_FLOOR_FAR_PLANE_MARGIN,
  CLOUD_FLOOR_NOISE_SCALE,
  CLOUD_FLOOR_RADIUS,
  cloudFloorFade,
  cloudFloorScroll,
  createCloudFloor,
} from "./cloudFloor.js";
import { createSkyDome } from "./skyDome.js";

const DAY = ENVIRONMENT_PRESETS.day;

const uniform = <T>(floor: ReturnType<typeof createCloudFloor>, name: string): T =>
  floor.mesh.material.uniforms[name]!.value as T;

describe("createCloudFloor", () => {
  it("is a level plane at the given height, facing up, reaching the floor's radius", () => {
    const floor = createCloudFloor(DAY, -7.5);
    floor.mesh.updateMatrixWorld();
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(floor.mesh.matrixWorld);
    floor.mesh.geometry.computeBoundingBox();

    expect(floor.mesh.position.y).toBe(-7.5);
    expect(normal.y).toBeCloseTo(1, 10);
    expect(floor.mesh.geometry.boundingBox!.max.x).toBe(CLOUD_FLOOR_RADIUS);
  });

  it("is fogged like the Track, and neither casts nor receives a shadow", () => {
    const { mesh } = createCloudFloor(DAY, 0);

    expect(mesh.material.fog).toBe(true);
    for (const name of ["fogColor", "fogNear", "fogFar"]) expect(mesh.material.uniforms).toHaveProperty(name);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
  });

  it("shades from world X/Z, never UVs, in two noise taps", () => {
    const { vertexShader, fragmentShader } = createCloudFloor(DAY, 0).mesh.material;

    expect(fragmentShader).toContain("vWorld.xz");
    expect(`${vertexShader}\n${fragmentShader}`).not.toMatch(/\buv\b/);
    expect(fragmentShader.match(/texture2D\(/g)).toHaveLength(2);
  });

  it("fades its edge into the sky after the fog, through the same output steps the dome takes", () => {
    const { fragmentShader } = createCloudFloor(DAY, 0).mesh.material;
    const fog = fragmentShader.indexOf("#include <fog_fragment>");

    expect(fog).toBeGreaterThan(fragmentShader.indexOf("#include <colorspace_fragment>"));
    expect(fragmentShader.indexOf("skyColour(normalize(vWorld - cameraPosition))")).toBeGreaterThan(fog);
    expect(fragmentShader.indexOf("linearToOutputTexel(sky)")).toBeGreaterThan(fog);
  });

  it("colours its clouds from the preset, and the sky it fades into matches the dome's", () => {
    const floor = createCloudFloor(DAY, 0);
    const dome = createSkyDome(DAY).material.uniforms;

    expect(uniform<THREE.Color>(floor, "lit").getHex()).toBe(DAY.cloudFloor.lit);
    expect(uniform<THREE.Color>(floor, "shade").getHex()).toBe(DAY.cloudFloor.shade);
    for (const name of ["zenith", "horizon", "nadir", "sunColor"]) {
      expect(uniform<THREE.Color>(floor, name).equals(dome[name]!.value as THREE.Color)).toBe(true);
    }
    expect(uniform<THREE.Vector3>(floor, "sunDirection").equals(dome.sunDirection!.value as THREE.Vector3)).toBe(true);
  });

  it("opens where the noise runs below the preset's threshold, and stays closed at 0", () => {
    const { material } = createCloudFloor({ ...DAY, cloudFloor: { ...DAY.cloudFloor, openBelow: 0.3 } }, 0).mesh;

    expect(material.uniforms.openBelow!.value).toBe(0.3);
    expect(material.fragmentShader).toContain("if (n < openBelow) discard;");
    // n is never below 0, so a threshold of 0 opens nothing.
    expect(createCloudFloor({ ...DAY, cloudFloor: { ...DAY.cloudFloor, openBelow: 0 } }, 0).mesh.material.uniforms.openBelow!.value).toBe(0);
  });

  it("samples a repeating single-channel noise tile", () => {
    const noise = uniform<THREE.DataTexture>(createCloudFloor(DAY, 0), "noise");

    expect(noise).toBeInstanceOf(THREE.DataTexture);
    expect(noise.format).toBe(THREE.RedFormat);
    expect(noise.wrapS).toBe(THREE.RepeatWrapping);
    expect(noise.wrapT).toBe(THREE.RepeatWrapping);
  });

  it("follows the camera across X/Z and never up or down", () => {
    const floor = createCloudFloor(DAY, -7.5);
    floor.update(new THREE.Vector3(12, 30, -40), 0);

    expect(floor.mesh.position.toArray()).toEqual([12, -7.5, -40]);
  });

  it("scrolls the clouds on the clock it is given", () => {
    const floor = createCloudFloor(DAY, 0);
    floor.update(new THREE.Vector3(), 2500);
    const expected = cloudFloorScroll(DAY.cloudFloor.wind, 2.5);

    expect(uniform<THREE.Vector2>(floor, "broadScroll").toArray()).toEqual([expected.broad.x, expected.broad.y]);
    expect(uniform<THREE.Vector2>(floor, "detailScroll").toArray()).toEqual([expected.detail.x, expected.detail.y]);
  });

  it("frees its geometry, material and the very noise texture it samples", () => {
    const floor = createCloudFloor(DAY, 0);
    const geometry = vi.spyOn(floor.mesh.geometry, "dispose");
    const material = vi.spyOn(floor.mesh.material, "dispose");
    const noise = vi.spyOn(uniform<THREE.DataTexture>(floor, "noise"), "dispose");

    floor.dispose();

    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(noise).toHaveBeenCalledOnce();
  });
});

describe("cloudFloorScroll", () => {
  const wind = { x: 0.6, z: -0.25 };

  it("starts unscrolled", () => {
    const { broad, detail } = cloudFloorScroll(wind, 0);
    expect([broad.x, broad.y, detail.x, detail.y].map((value) => value + 0)).toEqual([0, 0, 0, 0]);
  });

  it("moves the pattern with the wind: a world point samples what was upwind of it", () => {
    const seconds = 1;
    const { broad } = cloudFloorScroll(wind, seconds);
    // Wrapped into [0, 1): −0.009 on X is 0.991.
    expect(broad.x).toBeCloseTo(1 - wind.x * seconds * CLOUD_FLOOR_NOISE_SCALE, 10);
    expect(broad.y).toBeCloseTo(-wind.z * seconds * CLOUD_FLOOR_NOISE_SCALE, 10);
  });

  it("drifts its detail layer slower than the wind, so the clouds change as they move", () => {
    const seconds = 2;
    const { broad, detail } = cloudFloorScroll({ x: 0, z: -1 }, seconds);
    // In texture units per world unit, the detail layer is finer; per world unit of drift it moves less.
    const broadWorld = broad.y / CLOUD_FLOOR_NOISE_SCALE;
    const detailWorld = detail.y / (CLOUD_FLOOR_NOISE_SCALE * 2.7);
    expect(detailWorld).toBeGreaterThan(0);
    expect(detailWorld).toBeLessThan(broadWorld);
  });

  it("stays inside one tile however long the page has been open", () => {
    const { broad, detail } = cloudFloorScroll({ x: 3.3, z: -7.1 }, 60 * 60 * 24 * 9);
    for (const value of [broad.x, broad.y, detail.x, detail.y]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("cloudFloorFade (M13 ticket 04)", () => {
  it("fades across the plane to its own edge when no far plane can clip it", () => {
    for (const fade of [cloudFloorFade(), cloudFloorFade(1000)]) {
      expect(fade).toEqual({ start: CLOUD_FLOOR_FADE_START * CLOUD_FLOOR_RADIUS, end: CLOUD_FLOOR_RADIUS, fromCamera: false });
    }
  });

  it("is all sky, measured from the camera, before a far plane that would clip the plane", () => {
    const fade = cloudFloorFade(180);
    expect(fade.fromCamera).toBe(true);
    expect(fade.end).toBe(180 - CLOUD_FLOOR_FAR_PLANE_MARGIN);
    expect(fade.start).toBeCloseTo(CLOUD_FLOOR_FADE_START * fade.end, 10);
  });

  it("reaches the shader: the fade distances, and where they are measured from", () => {
    const clipped = createCloudFloor(DAY, 0, cloudFloorFade(180)).mesh.material;
    expect(clipped.defines).toHaveProperty("FADE_FROM_CAMERA");
    expect(clipped.uniforms.fadeEnd!.value).toBe(175);
    expect(clipped.fragmentShader).toContain("length(vWorld - cameraPosition)");

    const open = createCloudFloor(DAY, 0).mesh.material;
    expect(open.defines ?? {}).not.toHaveProperty("FADE_FROM_CAMERA");
    expect(open.uniforms.fadeStart!.value).toBe(CLOUD_FLOOR_FADE_START * CLOUD_FLOOR_RADIUS);
    expect(open.fragmentShader).toContain("smoothstep(fadeStart, fadeEnd, fadeDistance)");
  });
});
