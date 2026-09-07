import { chainTrack, hasSocket, type Module, type Track } from "@dont-fall/shared";

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
  const allIds = Object.keys(modules);
  if (allIds.length === 0) throw new Error("cannot generate a Track from an empty Module library");
  // Only Modules that can actually be chained (M5 ticket 06). Not every Module
  // has Sockets: one meant to be dropped on its own by free placement (ADR
  // 0034) — the Survival arena is the first — has none, and `chainTrack`
  // rightly throws rather than guessing where to put it. A generated Race
  // Track is chained end to end by definition, so a standalone piece simply
  // is not a candidate for one.
  const moduleIds = allIds.filter((id) => hasSocket(modules[id]!, "entry") && hasSocket(modules[id]!, "exit"));
  if (moduleIds.length === 0) {
    throw new Error("cannot generate a Track: no Module in the library has both an entry and an exit Socket");
  }
  const picked = Array.from({ length: count }, () => moduleIds[Math.floor(Math.random() * moduleIds.length)]!);
  return chainTrack(picked, modules);
};
