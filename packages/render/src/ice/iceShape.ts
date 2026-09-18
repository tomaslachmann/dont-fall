import type { DeckFrame } from "@dont-fall/shared";
import {
  deckToWorld,
  isOnDeck,
  mixRgb,
  mudCoverage,
  mudNoise,
  nearestFreeEdge,
  type MudEdge,
  type Rgb,
} from "../mud/mudShape.js";
import {
  ICE_BLOTCH_SIZE,
  ICE_COLOR_BASE,
  ICE_COLOR_DEEP,
  ICE_COLOR_FROST,
  ICE_COLOR_LIGHT,
  ICE_CRACK_CELL,
  ICE_CRACK_HALO,
  ICE_CRACK_WIDTH,
  ICE_DEPTH,
  ICE_GLINT_CHANCE,
  ICE_GLINT_FLASH_SECONDS,
  ICE_GLINT_INSET,
  ICE_GLINT_PERIOD_MAX,
  ICE_GLINT_PERIOD_MIN,
  ICE_GLINT_SIZE_MAX,
  ICE_GLINT_SIZE_MIN,
  ICE_GLINT_SPACING,
  ICE_RIM_WIDTH,
  ICE_SPECK_CELL,
  ICE_SPECK_CHANCE,
  ICE_SPECK_RADIUS_MAX,
  ICE_SPECK_RADIUS_MIN,
} from "./iceLook.js";

/**
 * The look of an ice deck (ADR 0107), as pure functions of where you are —
 * no three.js here, so the game and the Track builder cut the same ice and a
 * test can read it. The slab machinery — coverage over the bevel, the seam
 * rule, being on a deck — is the mud's own (ADR 0103, `mudShape.ts`): the two
 * masses stand on decks the same way, they just look nothing alike.
 *
 * The crack and speck fields take a `wrap` (metres): sampled for the detail
 * texture they repeat on its tile, so the texture wraps seamlessly, and the
 * texture is anchored to world space, so a vein runs on across a seam.
 */

type Point = { x: number; z: number };

/** The mud's own lattice hash (ADR 0103), with an optional periodic wrap for tileable fields. */
const hash = (ix: number, iz: number, seed: number, wrap = 0): number => {
  const wx = wrap > 0 ? ((ix % wrap) + wrap) % wrap : ix;
  const wz = wrap > 0 ? ((iz % wrap) + wrap) % wrap : iz;
  let h = Math.imul(wx, 0x27d4eb2d) ^ Math.imul(wz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const smoothstep = (from: number, to: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

const BLOTCH_SEED = 97;
const CRACK_SEED = 113;
const SPECK_SEED = 131;
const GLINT_SEED = 151;

/**
 * The crack veins at a point (0–1 each): the borders of a jittered cell
 * pattern — where the two nearest cell points stand equally close, which is
 * how sheet ice shatters into plates — as a thin bright core (`vein`) inside
 * a soft `halo`. `wrap` (metres) makes the pattern periodic for the texture.
 */
export const iceCrack = (x: number, z: number, wrap = 0): { vein: number; halo: number } => {
  const cells = wrap > 0 ? Math.max(1, Math.round(wrap / ICE_CRACK_CELL)) : 0;
  const u = x / ICE_CRACK_CELL;
  const v = z / ICE_CRACK_CELL;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let du = -1; du <= 1; du += 1) {
    for (let dv = -1; dv <= 1; dv += 1) {
      const cu = iu + du;
      const cv = iv + dv;
      const px = cu + 0.5 + 0.75 * (hash(cu, cv, CRACK_SEED, cells) - 0.5);
      const pz = cv + 0.5 + 0.75 * (hash(cu, cv, CRACK_SEED + 1, cells) - 0.5);
      const d = Math.hypot(u - px, v - pz);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  const border = (f2 - f1) * ICE_CRACK_CELL;
  return {
    vein: 1 - smoothstep(0, ICE_CRACK_WIDTH, border),
    halo: 1 - smoothstep(ICE_CRACK_WIDTH, ICE_CRACK_HALO, border),
  };
};

/**
 * The frozen bubbles at a point (0–1): pale specks, one to a share of the
 * cells of a fine jittered grid, each its own size and its own depth — the
 * deeper, the fainter. `wrap` as in {@link iceCrack}.
 */
export const iceSpecks = (x: number, z: number, wrap = 0): number => {
  const cells = wrap > 0 ? Math.max(1, Math.round(wrap / ICE_SPECK_CELL)) : 0;
  const u = x / ICE_SPECK_CELL;
  const v = z / ICE_SPECK_CELL;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  let best = 0;
  for (let du = -1; du <= 1; du += 1) {
    for (let dv = -1; dv <= 1; dv += 1) {
      const cu = iu + du;
      const cv = iv + dv;
      if (hash(cu, cv, SPECK_SEED, cells) >= ICE_SPECK_CHANCE) continue;
      const px = cu + 0.5 + 0.6 * (hash(cu, cv, SPECK_SEED + 1, cells) - 0.5);
      const pz = cv + 0.5 + 0.6 * (hash(cu, cv, SPECK_SEED + 2, cells) - 0.5);
      const radius =
        (ICE_SPECK_RADIUS_MIN + (ICE_SPECK_RADIUS_MAX - ICE_SPECK_RADIUS_MIN) * hash(cu, cv, SPECK_SEED + 3, cells)) / ICE_SPECK_CELL;
      const d = Math.hypot(u - px, v - pz);
      if (d >= radius) continue;
      const depth = hash(cu, cv, SPECK_SEED + 4, cells);
      const soft = 1 - smoothstep(radius * 0.45, radius, d);
      best = Math.max(best, soft * (1 - 0.7 * depth));
    }
  }
  return best;
};

const DEEP = rgbOf(ICE_COLOR_DEEP);
const BASE = rgbOf(ICE_COLOR_BASE);
const LIGHT = rgbOf(ICE_COLOR_LIGHT);
const FROST = rgbOf(ICE_COLOR_FROST);

function rgbOf(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/**
 * The painted colour of the slab's top at a world point (sRGB, 0–1): broad
 * soft blotches of the three pastels, frosted toward near-white over
 * `rimT` — 1 at a free edge, 0 a {@link ICE_RIM_WIDTH} in, the caller's read
 * of its own outline. The cracks and specks are the detail texture's, not
 * this colour's: a vein is far thinner than any sane vertex grid.
 */
export const iceColor = (wx: number, wz: number, rimT: number): Rgb => {
  const blotch = mudNoise(wx / ICE_BLOTCH_SIZE, wz / ICE_BLOTCH_SIZE, BLOTCH_SEED);
  let colour = mixRgb(DEEP, BASE, smoothstep(-0.5, -0.05, blotch));
  colour = mixRgb(colour, LIGHT, 0.7 * smoothstep(0.2, 0.55, blotch));
  return mixRgb(colour, FROST, Math.min(1, Math.max(0, rimT)));
};

/** How frosted a point `distance` metres from the nearest free edge is — the rim fades over {@link ICE_RIM_WIDTH}. */
export const iceRim = (distance: number): number => 1 - smoothstep(0, ICE_RIM_WIDTH, distance);

/** Where a glint sparkles on a deck, in the deck's own frame, and its rhythm. */
export interface IceGlintSite {
  x: number;
  z: number;
  size: number;
  /** Seconds from one sparkle to the next. */
  period: number;
  /** Where in its cycle this spot starts, 0–1 — so neighbouring spots never sparkle together. */
  phase: number;
  /** The star's own resting turn (radians), so no two sparkle the same way round. */
  tilt: number;
}

/**
 * The spots a deck's ice glints at: a grid across the deck (its coverage, as
 * the slab is), a share of its cells holding one, jittered inside its cell,
 * never within {@link ICE_GLINT_INSET} of a free edge. Seeded by where the
 * deck is, so the game and the Track builder sparkle in the same places and
 * two identical decks side by side do not sparkle in step.
 */
export const iceGlintSites = (deck: DeckFrame, edges: readonly MudEdge[]): IceGlintSite[] => {
  const seed = GLINT_SEED + Math.round(deck.center.x * 7) * 131 + Math.round(deck.center.z * 7) * 17 + Math.round(deck.center.y * 7);
  const nx = Math.max(1, Math.round((2 * deck.halfX) / ICE_GLINT_SPACING));
  const nz = Math.max(1, Math.round((2 * deck.halfZ) / ICE_GLINT_SPACING));
  const cellX = (2 * deck.halfX) / nx;
  const cellZ = (2 * deck.halfZ) / nz;
  const sites: IceGlintSite[] = [];
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      if (hash(i, j, seed) >= ICE_GLINT_CHANCE) continue;
      const p = {
        x: -deck.halfX + (i + 0.5 + 0.7 * (hash(i, j, seed + 1) - 0.5)) * cellX,
        z: -deck.halfZ + (j + 0.5 + 0.7 * (hash(i, j, seed + 2) - 0.5)) * cellZ,
      };
      if (!isOnDeck(deck, p, 0) || nearestFreeEdge(p, edges).distance < ICE_GLINT_INSET) continue;
      sites.push({
        ...p,
        size: ICE_GLINT_SIZE_MIN + (ICE_GLINT_SIZE_MAX - ICE_GLINT_SIZE_MIN) * hash(i, j, seed + 3),
        period: ICE_GLINT_PERIOD_MIN + (ICE_GLINT_PERIOD_MAX - ICE_GLINT_PERIOD_MIN) * hash(i, j, seed + 4),
        phase: hash(i, j, seed + 5),
        tilt: hash(i, j, seed + 6) * Math.PI,
      });
    }
  }
  return sites;
};

/**
 * A glint spot at `tSeconds`: the star's footprint scale (0 between
 * sparkles) and its turn. A pure function of the time, so any clock drives
 * it — the game's sim time, the builder's wall clock — and the same time
 * always draws the same sparkle.
 */
export const iceGlintPose = (site: IceGlintSite, tSeconds: number): { scale: number; spin: number } => {
  const cycle = (((tSeconds / site.period + site.phase) % 1) + 1) % 1;
  const flash = ICE_GLINT_FLASH_SECONDS / site.period;
  if (cycle >= flash) return { scale: 0, spin: site.tilt };
  const q = cycle / flash;
  return { scale: site.size * Math.sin(Math.PI * q), spin: site.tilt + 0.9 * q };
};

/** Re-exported beside the ice so its consumers name one module — the machinery is the mud's (ADR 0103). */
export { mudCoverage as iceCoverage, deckToWorld, type MudEdge as IceEdge };

/** The slab's top height above the deck — flat: the interest is the colour, the cracks and the gloss, not lumps. */
export const iceHeight = (): number => ICE_DEPTH;

export type { Point as IcePoint };
