/**
 * When the Round HUD calls something out (ADR 0088) — configuration, not feel.
 * Part of `tuning/` (see `index.ts`).
 */

// --- Round HUD (ADR 0088) ---------------------------------------------------

/**
 * How close the Character placed directly behind you must be before the Race
 * HUD calls it out ("X IS RIGHT BEHIND YOU"). Straight-line metres, capsule
 * centre to capsule centre — a couple of strides, close enough to shove you.
 */
export const HUD_THREAT_RADIUS_M = 6;

/**
 * The Survival HUD's danger warning lights once survivors are within this many
 * of the Survivor Target — one more Fall from the Round ending.
 */
export const CRITICAL_SURVIVORS_ABOVE_TARGET = 1;

/** …or once the Survival Round's clock is down to this. */
export const CRITICAL_TIME_LEFT_MS = 30_000;
