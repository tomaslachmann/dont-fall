import { DEFAULT_TIME_LIMIT_MS } from "../tuning.js";

/**
 * The rules a Round runs by, as data (M5 ticket 02, ADR 0041/0043) — never a
 * Round-type name. The shared step (and match authority) reads *fields* off
 * this, and a new Round type is a new field plus a resolver, not a branch
 * anywhere that reads it.
 *
 * Every field here has exactly one value for the life of a Round: resolved
 * once, before COUNTDOWN (`resolveRoundRules`), then replicated on the
 * snapshot beside `phase` so the client predicts against the identical
 * record the server simulates against. Nothing downstream re-resolves it.
 *
 * `timeLimitMs` is the first field, migrated off its old special-cased
 * Revision-only resolution (ADR 0038) onto this same general mechanism —
 * proving there is exactly one scheme, not one for the Time Limit and
 * another for everything M5 adds after it (Survival's own Survivor Target,
 * ticket 05).
 *
 * `fallBehavior` (ticket 03, ADR 0042) is the first field whose "default"
 * is never actually read off a Track — a Track carries no opinion on Round
 * type at all (ADR 0041), so its Track-defaults input to
 * {@link resolveRoundRules} is always the constant `"respawn"`; only a
 * Round's own override, once ticket 07 gives the Lobby a Round-type picker,
 * ever supplies `"eliminate"`. The same one mechanism, still — a Round type
 * is just the caller that knows which override to pass, never a name the
 * step itself sees.
 */
export interface RoundRules {
  /** How long a Round gets, in ms (ADR 0038, folded into ADR 0041's general mechanism). */
  timeLimitMs: number;
  /**
   * What follows a Character's Fall (ADR 0042): a Race respawns it at its
   * last Checkpoint with a penalty (ADR 0010, unchanged); Survival
   * eliminates it. The Fall itself — a Character's centre crossing the kill
   * plane — never varies; only this does.
   */
  fallBehavior: FallBehavior;
}

/** What follows a Character's Fall (ADR 0042) — see {@link RoundRules.fallBehavior}. */
export type FallBehavior = "respawn" | "eliminate";

/**
 * What a Round may override, field for field with {@link RoundRules} —
 * always optional (and explicitly `| undefined`, not just `Partial`, so a
 * caller building this from a conditional spread can pass an explicit
 * `undefined` and mean exactly what omitting the key means): "absent" is
 * itself meaningful, since it means this Round takes the Track's own
 * default rather than supplying its own.
 */
export interface RoundOverrides {
  timeLimitMs?: number | undefined;
  fallBehavior?: FallBehavior | undefined;
}

/** Every value {@link RoundRules} can take when nothing overrides anything — a Race, on a Track authored with no other opinion. */
export const DEFAULT_ROUND_RULES: RoundRules = {
  timeLimitMs: DEFAULT_TIME_LIMIT_MS,
  fallBehavior: "respawn",
};

/**
 * Resolve one Round's rules: the Track's own defaults, under the Round's
 * overrides, field by field — absent falls through (ADR 0041). One pure
 * function, called once per Round, is the entire mechanism; nothing else in
 * the server or the client is allowed to read the two sources separately.
 */
export const resolveRoundRules = (trackDefaults: RoundRules, overrides: RoundOverrides = {}): RoundRules => ({
  timeLimitMs: overrides.timeLimitMs ?? trackDefaults.timeLimitMs,
  fallBehavior: overrides.fallBehavior ?? trackDefaults.fallBehavior,
});
