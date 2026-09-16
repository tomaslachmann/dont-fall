import { ENVIRONMENT_PRESETS, sunDirection, type EnvironmentPreset } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SKY_DOME_RENDER_ORDER, createSkyDome } from "./skyDome.js";

const DAY = ENVIRONMENT_PRESETS.day;

const withDisc = (discRadiusDeg: number): EnvironmentPreset => ({
  ...DAY,
  sky: { ...DAY.sky, sun: { ...DAY.sky.sun, discRadiusDeg } },
});

describe("createSkyDome", () => {
  it("is a unit sphere seen from inside, behind everything and outside the fog", () => {
    const dome = createSkyDome(DAY);
    dome.geometry.computeBoundingSphere();

    expect(dome.geometry.boundingSphere!.radius).toBeCloseTo(1, 6);
    expect(dome.material.side).toBe(THREE.BackSide);
    expect(dome.material.depthWrite).toBe(false);
    expect(dome.material.fog).toBe(false);
    expect(dome.material.transparent).toBe(false);
    expect(dome.renderOrder).toBe(SKY_DOME_RENDER_ORDER);
    expect(dome.castShadow).toBe(false);
    expect(dome.receiveShadow).toBe(false);
  });

  it("puts its depth on the far plane", () => {
    expect(createSkyDome(DAY).material.vertexShader).toContain("gl_Position = clip.xyww");
  });

  it("tone-maps and converts itself, so the builder's direct-to-canvas path is right too", () => {
    const { fragmentShader } = createSkyDome(DAY).material;
    const toneMapping = fragmentShader.indexOf("#include <tonemapping_fragment>");
    const colourSpace = fragmentShader.indexOf("#include <colorspace_fragment>");
    expect(toneMapping).toBeGreaterThan(fragmentShader.indexOf("gl_FragColor ="));
    expect(colourSpace).toBeGreaterThan(toneMapping);
  });

  it("takes its colour stops and sun from the preset, as authored sRGB", () => {
    const { uniforms } = createSkyDome(DAY).material;

    expect((uniforms.zenith!.value as THREE.Color).getHex()).toBe(DAY.sky.zenith);
    expect((uniforms.horizon!.value as THREE.Color).getHex()).toBe(DAY.sky.horizon);
    expect((uniforms.nadir!.value as THREE.Color).getHex()).toBe(DAY.sky.nadir);
    expect((uniforms.sunColor!.value as THREE.Color).getHex()).toBe(DAY.sky.sun.color);
    expect(uniforms.horizonSoftness!.value).toBe(DAY.sky.horizonSoftness);

    const expected = sunDirection(DAY);
    const sun = uniforms.sunDirection!.value as THREE.Vector3;
    expect(sun.x).toBeCloseTo(expected.x, 10);
    expect(sun.y).toBeCloseTo(expected.y, 10);
    expect(sun.z).toBeCloseTo(expected.z, 10);
  });

  it("draws a disc whose solid core sits inside its angular radius", () => {
    const { uniforms } = createSkyDome(withDisc(4)).material;
    const outer = uniforms.sunCosOuter!.value as number;
    const inner = uniforms.sunCosInner!.value as number;

    expect(uniforms.sunVisible!.value).toBe(1);
    expect(outer).toBeCloseTo(Math.cos((4 * Math.PI) / 180), 10);
    // A cosine grows toward the centre: the core edge is nearer the sun than the rim.
    expect(inner).toBeGreaterThan(outer);
    expect(inner).toBeLessThan(1);
  });

  it("draws no disc at radius 0", () => {
    expect(createSkyDome(withDisc(0)).material.uniforms.sunVisible!.value).toBe(0);
  });

  it("is never culled, since it always surrounds the camera", () => {
    expect(createSkyDome(DAY).frustumCulled).toBe(false);
  });
});
