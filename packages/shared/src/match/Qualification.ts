import type { MatchPhase } from "./MatchPhase.js";

/** The slice of a Character that Qualification depends on — the Tick it finished on, and whether it's out of contention entirely (M5 ticket 04). */
interface Qualifiable {
  finishTick: number | null;
  /** See `CharacterSnapshot.eliminated`. Optional so nothing outside `RapierSimulation`'s own snapshot has to know about it to stay `Qualifiable`. */
  eliminated?: boolean;
}

/**
 * Whether every connected Character is resolved — either it reached the
 * Finish Zone, or it is eliminated (M4 ticket 05; M5 ticket 04 folds
 * elimination in) — the condition that ends a Round early, before its clock
 * runs out.
 *
 * An eliminated Character (a mid-Round disconnect — marked, not removed,
 * M5 ticket 04 — or Survival's own Fall rule) can never reach `finishTick`
 * again; without this it would hold a Race open for the rest of its Time
 * Limit on everyone else's behalf, the exact live flaw ticket 04 fixes.
 *
 * An empty Match is deliberately `false`: nobody having Qualified is not
 * everybody having Qualified, and treating it as true would have an empty
 * server end a Round it never started.
 */
export const allQualified = (characters: Record<string, Qualifiable>): boolean => {
  const all = Object.values(characters);
  return all.length > 0 && all.every((character) => character.finishTick !== null || character.eliminated === true);
};

/**
 * Whether a Survival Round has reached its Survivor Target (M5 ticket 05,
 * ADR 0042, CONTEXT.md) — the Survival-shaped sibling of {@link allQualified},
 * fed into the identical RUNNING → ROUND_END transition Race already uses
 * (`matchLoop.ts` picks whichever of the two applies; `advanceMatchPhase`
 * itself stays Round-type-agnostic either way).
 *
 * Counts survivors *at or below* the target rather than requiring an exact
 * match: a lopsided Impact that eliminates two Characters on the same Tick
 * must still end the Round, not skip past its own ending condition.
 *
 * An empty Match is deliberately `false` too, for the identical reason
 * {@link allQualified} is: nobody connected is not a Round with survivors
 * left standing, and treating it as true would end a Round nobody started.
 */
export const survivorTargetReached = (characters: Record<string, Pick<Qualifiable, "eliminated">>, survivorTarget: number): boolean => {
  const all = Object.values(characters);
  if (all.length === 0) return false;
  const survivors = all.filter((character) => character.eliminated !== true).length;
  return survivors <= survivorTarget;
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
