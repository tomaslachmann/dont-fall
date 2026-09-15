import { DEFAULT_TIME_LIMIT_MS, MAX_TIME_LIMIT_MS, MIN_TIME_LIMIT_MS } from "@dont-fall/shared";

/**
 * The Draft's Time Limit field as milliseconds (M4 ticket 03, ADR 0038) —
 * authored in seconds, because that is how a track designer thinks about a
 * Round, and stored in ms, because that is what the Revision carries.
 *
 * Blank and non-numeric both mean "I didn't choose", and take the default.
 * That distinction matters: `Number("")` is 0, so folding the empty field in
 * with the numbers would clamp it to the *floor* and quietly publish a
 * ten-second Round — permanently, since a Revision is immutable (ADR 0032).
 *
 * A real number that is merely out of range is clamped rather than discarded:
 * the author meant something, and the nearest legal clock beats a publish
 * rejected after they have moved on.
 */
export const parseDraftTimeLimitMs = (value: string): number => {
  if (value.trim() === "") return DEFAULT_TIME_LIMIT_MS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_TIME_LIMIT_MS;
  const ms = Math.round(seconds * 1000);
  return Math.min(MAX_TIME_LIMIT_MS, Math.max(MIN_TIME_LIMIT_MS, ms));
};
