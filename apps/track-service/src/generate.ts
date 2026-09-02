import { chainTrack, type Module, type Track } from "@dont-fall/shared";

const DEFAULT_MODULE_COUNT = 5;

/**
 * Randomly assembles a Track by picking `count` Module ids (with
 * replacement) from `modules` and chaining them end-to-end via `chainTrack`
 * — no compatibility check needed, by construction, since every current
 * Socket is the same type (ADR 0031, supersedes ADR 0030's single global
 * step). This is the ONLY thing that distinguishes a "random" Track from a
 * hand-built one; once assembled it's saved and fetched exactly like any
 * other (ADR 0028).
 */
export const generateRandomTrack = (
  modules: Record<string, Module>,
  count: number = DEFAULT_MODULE_COUNT,
): Track => {
  const moduleIds = Object.keys(modules);
  if (moduleIds.length === 0) throw new Error("cannot generate a Track from an empty Module library");
  const picked = Array.from({ length: count }, () => moduleIds[Math.floor(Math.random() * moduleIds.length)]!);
  return chainTrack(picked, modules);
};
