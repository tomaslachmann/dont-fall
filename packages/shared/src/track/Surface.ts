/**
 * A Track floor's Surface id (CONTEXT.md) — how well a Character grips a
 * piece of floor and how fast it may ultimately travel on it. Resolved from
 * `Box.surface ?? Module.surface ?? DEFAULT_SURFACE`, once, in `Track.ts`'s
 * `resolveTrack` (ADR 0036) — never re-resolved in the tick loop.
 *
 * An open string, not a closed union: a new Surface is added to
 * {@link SURFACES} below without touching this type or anywhere it's used —
 * exactly like `Module.id`/`Segment.moduleId`.
 */
export type SurfaceId = string;

/**
 * A Surface's effect on movement. Ticket 01 (mud) only needs a top-speed
 * cap — the current movement model assigns velocity outright, so "grip"
 * (a scalar multiplying both acceleration and drag, ADR 0035/0036) has
 * nothing to multiply yet and lands once the acceleration model does
 * (ticket 05), alongside ice (ticket 06).
 */
export interface SurfaceConfig {
  /** Multiplies WALK_SPEED while standing on this Surface. 1 = unchanged. */
  topSpeedMultiplier: number;
}

/** What every Box/Module resolves to when it declares no Surface of its own. */
export const DEFAULT_SURFACE: SurfaceId = "default";

/**
 * Every Surface a resolved Track's floor can be (ADR 0036). Numeric values
 * are deliberately provisional — the milestone spec records the exact
 * multiplier as "a measurement, not a decision," to be tuned against a real
 * ramp/mud Module once one exists, not re-litigated here.
 */
export const SURFACES: Record<SurfaceId, SurfaceConfig> = {
  [DEFAULT_SURFACE]: { topSpeedMultiplier: 1 },
  mud: { topSpeedMultiplier: 0.5 },
};

/**
 * A Surface's config, falling back to {@link DEFAULT_SURFACE} for `undefined`
 * (no ground contact, e.g. mid-air) or an id `SURFACES` doesn't recognise —
 * defensive: every id a resolved Track actually carries comes from
 * `SURFACES`' own keys, but a Surface could in principle be renamed/removed
 * out from under an already-published Track. The single place that decides
 * "no Surface found" resolves to `DEFAULT_SURFACE` (code review, ticket 01)
 * — a caller should never re-implement this fallback inline, or the two
 * could silently diverge if this policy ever changes.
 */
export const surfaceConfig = (id: SurfaceId | undefined): SurfaceConfig =>
  SURFACES[id ?? DEFAULT_SURFACE] ?? SURFACES[DEFAULT_SURFACE]!;
