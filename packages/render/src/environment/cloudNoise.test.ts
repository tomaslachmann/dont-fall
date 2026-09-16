import { describe, expect, it } from "vitest";
import { CLOUD_NOISE_SIZE, generateCloudNoise } from "./cloudNoise.js";

const texel = (noise: Uint8Array, size: number, x: number, y: number): number =>
  noise[(((y % size) + size) % size) * size + (((x % size) + size) % size)]!;

/** The largest step between horizontally or vertically neighbouring texels, optionally across the wrap only. */
const largestStep = (noise: Uint8Array, size: number, acrossWrapOnly: boolean): number => {
  let largest = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const onEdge = x === size - 1 || y === size - 1;
      if (acrossWrapOnly && !onEdge) continue;
      if (!acrossWrapOnly || x === size - 1) largest = Math.max(largest, Math.abs(texel(noise, size, x, y) - texel(noise, size, x + 1, y)));
      if (!acrossWrapOnly || y === size - 1) largest = Math.max(largest, Math.abs(texel(noise, size, x, y) - texel(noise, size, x, y + 1)));
    }
  }
  return largest;
};

describe("generateCloudNoise", () => {
  it("is one byte per texel of a square tile", () => {
    expect(generateCloudNoise()).toHaveLength(CLOUD_NOISE_SIZE * CLOUD_NOISE_SIZE);
  });

  it("uses the full byte range, so the floor shader's thresholds mean the same on every tile", () => {
    const noise = generateCloudNoise();
    expect(Math.min(...noise)).toBe(0);
    expect(Math.max(...noise)).toBe(255);
  });

  it("wraps without a seam: no step across the tile's edge is bigger than the steps inside it", () => {
    const noise = generateCloudNoise();
    const inside = largestStep(noise, CLOUD_NOISE_SIZE, false);
    expect(largestStep(noise, CLOUD_NOISE_SIZE, true)).toBeLessThanOrEqual(inside);
    // Smooth at all: a texel never jumps a large share of the range from its neighbour.
    expect(inside).toBeLessThan(32);
  });

  it("draws the same clouds for the same seed, and others for another", () => {
    expect(generateCloudNoise(64, 7)).toEqual(generateCloudNoise(64, 7));
    expect(generateCloudNoise(64, 7)).not.toEqual(generateCloudNoise(64, 8));
  });

  it("refuses a size that some octave does not divide, which could not wrap", () => {
    expect(() => generateCloudNoise(100)).toThrow(/multiple/);
  });
});
