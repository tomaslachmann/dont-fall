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
 * ticket 05; what a Fall does, ticket 03).
 */
export interface RoundRules {
  /** How long a Round gets, in ms (ADR 0038, folded into ADR 0041's general mechanism). */
  timeLimitMs: number;
}

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
}

/** Every value {@link RoundRules} can take when nothing overrides anything — a Race, on a Track authored with no other opinion. */
export const DEFAULT_ROUND_RULES: RoundRules = {
  timeLimitMs: DEFAULT_TIME_LIMIT_MS,
};

/**
 * Resolve one Round's rules: the Track's own defaults, under the Round's
 * overrides, field by field — absent falls through (ADR 0041). One pure
 * function, called once per Round, is the entire mechanism; nothing else in
 * the server or the client is allowed to read the two sources separately.
 */
export const resolveRoundRules = (trackDefaults: RoundRules, overrides: RoundOverrides = {}): RoundRules => ({
  timeLimitMs: overrides.timeLimitMs ?? trackDefaults.timeLimitMs,
});
