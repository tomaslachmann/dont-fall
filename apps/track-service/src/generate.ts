import { type Track, chainTrack } from "@dont-fall/shared";

const DEFAULT_MODULE_COUNT = 5;

/**
 * Randomly assembles a Track by picking `count` Module ids (with
 * replacement) from `moduleIds` and chaining them end-to-end via
 * `chainTrack` — no compatibility check needed, by construction, since every
 * Module shares the same footprint (ADR 0030). This is the ONLY thing that
 * distinguishes a "random" Track from a hand-built one; once assembled it's
 * saved and fetched exactly like any other (ADR 0028).
 */
export const generateRandomTrack = (moduleIds: string[], count: number = DEFAULT_MODULE_COUNT): Track => {
  if (moduleIds.length === 0) throw new Error("cannot generate a Track from an empty Module library");
  const picked = Array.from({ length: count }, () => moduleIds[Math.floor(Math.random() * moduleIds.length)]!);
  return chainTrack(picked);
};
