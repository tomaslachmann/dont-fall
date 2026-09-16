import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { STARS_LOWEST_Y, createStars, starDirections } from "./stars.js";

const STARS = { count: 400, color: 0xf2f4ff, size: 2.5 };

describe("starDirections", () => {
  it("is one unit direction per star, all above the lowest height", () => {
    const positions = starDirections(400);
    expect(positions).toHaveLength(1200);
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(y).toBeGreaterThanOrEqual(STARS_LOWEST_Y - 1e-6);
    }
  });

  it("spreads evenly over the sky rather than bunching at the zenith", () => {
    const positions = starDirections(4000);
    const heights = Array.from({ length: 4000 }, (_, i) => positions[i * 3 + 1]!);
    const middle = (STARS_LOWEST_Y + 1) / 2;
    const below = heights.filter((y) => y < middle).length;
    // Uniform in height: about half below the middle height.
    expect(below / heights.length).toBeGreaterThan(0.45);
    expect(below / heights.length).toBeLessThan(0.55);
  });

  it("scatters the same stars every time", () => {
    expect(starDirections(50)).toEqual(starDirections(50));
  });
});

describe("createStars", () => {
  it("draws behind everything, after the dome, outside the fog, and never in a shadow", () => {
    const stars = createStars(STARS);

    expect(stars).toBeInstanceOf(THREE.Points);
    expect(stars.material.vertexShader).toContain("gl_Position = clip.xyww");
    expect(stars.material.transparent).toBe(true);
    expect(stars.material.depthWrite).toBe(false);
    expect(stars.material.fog).toBe(false);
    expect(stars.frustumCulled).toBe(false);
    expect(stars.castShadow).toBe(false);
    expect(stars.receiveShadow).toBe(false);
  });

  it("takes its count, colour and size from the preset", () => {
    const stars = createStars(STARS);

    expect(stars.geometry.getAttribute("position").count).toBe(STARS.count);
    expect((stars.material.uniforms.color!.value as THREE.Color).getHex()).toBe(STARS.color);
    expect(stars.material.uniforms.size!.value).toBe(STARS.size);
  });
});
