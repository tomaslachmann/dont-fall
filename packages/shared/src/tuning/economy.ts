/**
 * What a Match pays, and what a spectator may bet on it (ADR 0052) —
 * configuration, not feel. Part of `tuning/` (see `index.ts`).
 */

// --- Match earnings (XP + beans) --------------------------------------------

/**
 * XP per point of Match Score — a 500-point Match pays 1,000 XP. Linear on
 * purpose: Score is already percentile-normalised per Round (`roundScore`),
 * so earnings stay comparable across field sizes without a second
 * normalisation here.
 */
export const XP_PER_MATCH_SCORE = 2;

/**
 * Beans per placement step — winner of an N-Player Round takes `N` steps.
 * Placement, not Score: beans are the shiny prize currency, and prizes read
 * as ranks ("I won"), not fractions.
 */
export const BEANS_PER_PLACEMENT_STEP = 10;

/** What every Round banks regardless of placement — showing up pays. */
export const BEANS_PARTICIPATION_FLOOR = 10;

/**
 * Total XP a level costs to *leave* — triangular on purpose: each level
 * costs `XP_LEVEL_BASE` more than the last, so early levels fly (hook) and
 * later ones grind (retention), with no table to maintain.
 */
export const XP_LEVEL_BASE = 1_000;

// --- Spectator wagering (ticket 14) -----------------------------------------

/**
 * How long into a Round spectators may stake on it — measured from the
 * Round's start, enforced by the API's `closesAtMs`, shown as the panel's
 * CLOSES countdown. Long enough that an early knockout can still get a bet
 * down, short enough that late-Round odds mean something. A balance value:
 * move it when Rounds get longer or shorter on average.
 */
export const BETTING_WINDOW_MS = 60_000;
