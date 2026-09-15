import { DEFAULT_SURVIVOR_TARGET, MAX_SURVIVOR_TARGET, MIN_SURVIVOR_TARGET } from "@dont-fall/shared";

/**
 * The Draft's Survivor Target field as a whole number of Players (M5 ticket
 * 07, ADR 0041) — the exact counterpart of `parseDraftTimeLimitMs`, and
 * deliberately shaped the same way rather than cleverer:
 *
 * Blank and non-numeric both mean "I didn't choose", and take the default —
 * `Number("")` is 0, so folding the empty field in with the numbers would
 * clamp it to the floor of 1 and quietly publish a winner-takes-all Round.
 *
 * A real number that is merely out of range is clamped rather than
 * discarded: the author meant something, and the nearest legal target beats
 * a publish rejected after they have moved on. A fraction of a Player is
 * rounded, since half a survivor is not a thing a Round can end on.
 */
export const parseDraftSurvivorTarget = (value: string): number => {
  if (value.trim() === "") return DEFAULT_SURVIVOR_TARGET;
  const players = Number(value);
  if (!Number.isFinite(players)) return DEFAULT_SURVIVOR_TARGET;
  return Math.min(MAX_SURVIVOR_TARGET, Math.max(MIN_SURVIVOR_TARGET, Math.round(players)));
};
