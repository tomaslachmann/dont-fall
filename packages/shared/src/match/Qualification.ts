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

/**
 * Where `id` placed among everyone who has Qualified, 1-based, or `null` if
 * that Character has not Qualified (M4 ticket 02).
 *
 * A pure projection of the Characters in one snapshot — Qualification itself
 * is `finishTick`, derived by the shared simulation from position alone (ADR
 * 0039), so placement needs nothing on the wire of its own. Read it from the
 * authoritative server snapshot rather than the local prediction: a client
 * only predicts its *own* Character, so its local sim has no idea when
 * anyone else crossed the line.
 *
 * Standard competition ranking — two Characters that entered on the same Tick
 * share a placement and the next one down skips. A Finish Zone is an area,
 * not a line (CONTEXT.md), precisely so that arriving together is possible;
 * inventing a tie-break here would be inventing a rule the simulation
 * doesn't have.
 */
export const qualificationPlacement = (characters: Record<string, Qualifiable>, id: string): number | null => {
  const mine = characters[id]?.finishTick;
  if (mine === undefined || mine === null) return null;
  let ahead = 0;
  for (const character of Object.values(characters)) {
    if (character.finishTick !== null && character.finishTick < mine) ahead += 1;
  }
  return ahead + 1;
};
