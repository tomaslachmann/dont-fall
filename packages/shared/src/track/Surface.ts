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
 * A Surface's effect on movement (ADR 0035/0036). Two independent knobs,
 * per Source's own model:
 *
 * - `topSpeedMultiplier` — scales the *target* (`WALK_SPEED`) a Character's
 *   velocity is chasing. Mud's whole effect (ticket 01): a lower ceiling,
 *   acceleration/drag left alone.
 * - `grip` — one scalar multiplying **both** acceleration and drag
 *   (`movementVerbs.ts`'s `accelerateVelocity` factors, ticket 06) — how
 *   *quickly* that target is reached and how quickly you stop/turn,
 *   independent of what the target itself is. Ice's whole effect: near-zero
 *   grip, top speed untouched. "Ice makes you faster" is the intuitive
 *   answer and the wrong one — neither Quake nor Source touches max speed
 *   for slick surfaces; the feel is carried entirely by lost acceleration
 *   and lost turn authority.
 *
 * Before ticket 05's acceleration model, `grip` had nothing to multiply —
 * every Surface implicitly had "infinite" grip (velocity assigned outright
 * every tick). Now that accelerate/drag/cap is real, both knobs are ordinary
 * multipliers on the same pipeline, not two special cases.
 */
export interface SurfaceConfig {
  /** Multiplies WALK_SPEED while standing on this Surface. 1 = unchanged. */
  topSpeedMultiplier: number;
  /**
   * Multiplies both `MOVE_ACCEL_FACTOR` and `MOVE_FRICTION_FACTOR` (ticket
   * 06). 1 = full grip (today's engineered-to-saturate default — reaches
   * target speed and stops within a single tick, ticket 05). Near-zero =
   * ice: acceleration and drag both slow to a crawl.
   */
  grip: number;
  /**
   * M3.7 ticket 02: if set, landing on this Surface reverses vertical
   * velocity instead of the ordinary ground-stick clamp — a trampoline, not
   * a launcher. Absent (the default) on every other Surface: a bounce is a
   * per-Surface property, not something every floor tile has an opinion on.
   */
  bounce?: SurfaceBounceConfig;
}

/**
 * A bouncy Surface's landing physics (M3.7 ticket 02) — computed from the
 * Character's own impact velocity, per the research doc's own model
 * (`docs/research/surface-and-volume-mechanics.md` §1.4): "one-shot per
 * landing... that is what makes it a bounce rather than a launcher: a small
 * fall gives a small bounce." Contrast with a launch pad (`LaunchPad.ts`),
 * which sets a fixed velocity regardless of how you arrived.
 */
export interface SurfaceBounceConfig {
  /** Multiplies incoming downward speed on landing. 0.85 = loses 15% of vertical speed per bounce, not a perfectly elastic one. */
  restitution: number;
  /** Floor under the resulting upward speed, so even a slow landing still bounces noticeably — a walk-on shouldn't feel like nothing happened. */
  minSpeed: number;
}

/** What every Box/Module resolves to when it declares no Surface of its own. */
export const DEFAULT_SURFACE: SurfaceId = "default";

/**
 * Every Surface a resolved Track's floor can be (ADR 0036). Numeric values
 * are deliberately provisional — the milestone spec records the exact
 * multiplier as "a measurement, not a decision," to be tuned against a real
 * ramp/mud/ice Module once one exists, not re-litigated here. Mud and ice
 * are deliberately near-mirror images of each other (ticket 06): mud caps
 * the target speed and leaves grip alone, ice leaves the target speed alone
 * and caps grip — the two knobs are independent, and each Surface here only
 * ever needs to touch the one that carries its own feel.
 */
export const SURFACES: Record<SurfaceId, SurfaceConfig> = {
  [DEFAULT_SURFACE]: { topSpeedMultiplier: 1, grip: 1 },
  mud: { topSpeedMultiplier: 0.5, grip: 1 },
  ice: { topSpeedMultiplier: 1, grip: 0.001 },
  bounce: { topSpeedMultiplier: 1, grip: 1, bounce: { restitution: 0.85, minSpeed: 6 } },
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
