import type { MatchPhase } from "./MatchPhase.js";

/** The slice of a Character that Qualification depends on — nothing but the Tick it finished on. */
interface Qualifiable {
  finishTick: number | null;
}

/**
 * Whether every connected Character has reached the Finish Zone (M4 ticket
 * 05) — the condition that ends a Round early, before its clock runs out.
 *
 * An empty Match is deliberately `false`: nobody having Qualified is not
 * everybody having Qualified, and treating it as true would have an empty
 * server end a Round it never started.
 */
export const allQualified = (characters: Record<string, Qualifiable>): boolean => {
  const all = Object.values(characters);
  return all.length > 0 && all.every((character) => character.finishTick !== null);
};

/**
 * Whether this Character was Eliminated (CONTEXT.md) — it did not Qualify
 * before the Round ended.
 *
 * Derived rather than stored, and derived from state both sides already have:
 * Elimination is exactly "the Round is over and you have no `finishTick`", so
 * there is nothing to replicate and nothing that can disagree.
 *
 * Note what is *not* here: how far they got, or how often they Fell. A Fall
 * never eliminates (CONTEXT.md) — it only costs time through Respawn.
 */
export const isEliminated = (phase: MatchPhase, finishTick: number | null): boolean =>
  (phase === "ROUND_END" || phase === "RESULTS") && finishTick === null;
