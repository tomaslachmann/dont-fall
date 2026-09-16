import { seededRandom } from "./random.js";

/** The generated noise tile's side, in texels. */
export const CLOUD_NOISE_SIZE = 256;

/**
 * Lattice cells across the tile per octave, coarsest first. Each divides
 * {@link CLOUD_NOISE_SIZE}, which is what makes every octave, and so the sum,
 * wrap seamlessly.
 */
const OCTAVE_CELLS = [4, 8, 16, 32, 64] as const;

/** Each octave's weight relative to the one before it. */
const PERSISTENCE = 0.5;

/** Quintic fade: flat at both ends, so no crease shows along a lattice line. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * A tileable greyscale noise tile for the cloud floor (ADR 0074, research §8):
 * fractal value noise, one byte per texel, row-major, stretched to use the full
 * 0–255 range. Generated in code, so there is no fetch, no asset and no licence.
 * Pure CPU data: each Environment wraps it in its own texture.
 */
export const generateCloudNoise = (size: number = CLOUD_NOISE_SIZE, seed = 1): Uint8Array<ArrayBuffer> => {
  for (const cells of OCTAVE_CELLS) {
    if (size % cells !== 0) throw new Error(`cloud noise size ${size} is not a multiple of ${cells}`);
  }
  const next = seededRandom(seed);
  const sum = new Float32Array(size * size);
  let amplitude = 1;
  for (const cells of OCTAVE_CELLS) {
    const lattice = Float32Array.from({ length: cells * cells }, next);
    const at = (column: number, row: number): number => lattice[(row % cells) * cells + (column % cells)]!;
    const texelsPerCell = size / cells;
    for (let y = 0; y < size; y += 1) {
      const row = Math.floor(y / texelsPerCell);
      const v = fade((y % texelsPerCell) / texelsPerCell);
      for (let x = 0; x < size; x += 1) {
        const column = Math.floor(x / texelsPerCell);
        const u = fade((x % texelsPerCell) / texelsPerCell);
        const top = at(column, row) + (at(column + 1, row) - at(column, row)) * u;
        const bottom = at(column, row + 1) + (at(column + 1, row + 1) - at(column, row + 1)) * u;
        const i = y * size + x;
        sum[i] = sum[i]! + (top + (bottom - top) * v) * amplitude;
      }
    }
    amplitude *= PERSISTENCE;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const value of sum) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const range = max - min || 1;
  return Uint8Array.from(sum, (value) => Math.round(((value - min) / range) * 255));
};
