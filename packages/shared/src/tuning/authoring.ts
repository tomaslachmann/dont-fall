/**
 * What a Track author may store, and what an Asset must be to load —
 * configuration, not feel. Part of `tuning/` (see `index.ts`).
 */

// --- Segment scale (ADR 0062) -----------------------------------------------

/** The smallest and largest uniform `Segment.scale` a Track may store (ADR 0062). */
export const MIN_SEGMENT_SCALE = 0.25;
export const MAX_SEGMENT_SCALE = 4;

// --- Spring heights (ADR 0069) ----------------------------------------------

/**
 * How high a Spring throws, in metres above the deck it fires from — the one
 * number the Track author types (the builder's presets write this same field).
 * A plain jump reaches `JUMP_VELOCITY² / (2·|GRAVITY_Y|)` ≈ 2.3 m, so even the
 * low preset is unmistakably a Spring and not a jump. `MEDIUM` is where the
 * deleted procedural pad always threw (`velocity.y = 16` ≈ 5.8 m).
 * Provisional tuning — a measurement, not a decision.
 */
export const LAUNCH_HEIGHT_PRESETS = { low: 3, medium: 6, high: 10 } as const;

/** Author-settable range for a Spring's height (metres) — below this it reads as a jump, above it as a mistake. */
export const LAUNCH_HEIGHT_MIN = 1;
export const LAUNCH_HEIGHT_MAX = 20;

// --- Assets (M8 ticket 01, ADR 0050) ----------------------------------------

/**
 * How far an Asset's collision may spill past its Module's footprint before
 * the load fails. The anti-gap overlap allowance: micro-seams between
 * Segments (bevels, exporter rounding) seal shut when neighboring colliders
 * overlap slightly, and overlapping statics cost nothing in Rapier. 0.02 is
 * invisible at gameplay scale — anything more is a mis-measured file, not a
 * seam, and must fail identically on both sides rather than simulate
 * differently per side.
 */
export const ASSET_FOOTPRINT_EPSILON = 0.02;

/**
 * How far an Asset's visual may escape its collision before the loader
 * reports it. A dev warning, never an error — visuals may legitimately vary
 * (detail, LOD, compression) while collision stays single-source. 0.05 stays
 * silent on rounding noise but catches a genuinely misplaced visual.
 */
export const ASSET_VISUAL_WARN = 0.05;
