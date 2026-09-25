/**
 * A Bot's randomness (ADR 0129): everything a Bot draws comes from its seed,
 * never `Math.random()`, so a suite's Bot plays the same every run and a live
 * Lobby's Bots differ only because their seeds do.
 *
 * FNV-1a over the seed, then mulberry32. Neither needs to be more than well
 * spread: nothing here is a secret.
 */

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** A stream of draws in `[0, 1)` from `seed`: what a Bot's `mistreevous` tree is given as its `random`. */
export const botRandom = (seed: string): (() => number) => {
  let state = fnv1a(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

/**
 * One draw in `[0, 1)` for `seed` and `key`, the same every time it is asked:
 * a Bot's standing preference about one thing, such as which arm of a fork it
 * takes, that must not change because it asked twice.
 */
export const botDraw = (seed: string, key: string): number => botRandom(`${seed}\u0000${key}`)();
