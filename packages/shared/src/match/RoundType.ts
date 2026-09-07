import type { RoundOverrides } from "./RoundRules.js";

/**
 * A Round type, by name (CONTEXT.md) — the Lobby's own vocabulary, and the
 * only place in the codebase a Round type ever *is* a name.
 *
 * ADR 0043 is emphatic that the shared step never branches on a mode, and
 * nothing here changes that: this type exists at the Lobby boundary (a host
 * picks one, every client renders it), and {@link roundTypeOverrides} turns
 * it into plain {@link RoundOverrides} data before it reaches anything that
 * simulates. Downstream of that call there is no Round type left — only
 * fields. That is exactly the "a Round type is just the caller that knows
 * which override to pass" split `RoundRules` describes; ticket 07 is the
 * caller it was waiting for.
 */
export type RoundType = "race" | "survival";

/** Every Round type, in the order a Lobby offers them (M5 ticket 07). */
export const ROUND_TYPES: readonly RoundType[] = ["race", "survival"];

/**
 * What a Lobby starts on: a Race. The Round type M1–M4 already were, so a
 * Lobby that never touches the picker behaves exactly as it did before this
 * ticket.
 */
export const DEFAULT_ROUND_TYPE: RoundType = "race";

/** A Round type's own display name — the Lobby shows this, never the raw id. */
export const roundTypeLabel = (type: RoundType): string => (type === "survival" ? "Survival" : "Race");

/**
 * A Round type as {@link RoundOverrides} — the one and only translation from
 * name to data (ADR 0043), and the whole of what picking a Round type does.
 *
 * Only `fallBehavior` is here. `survivorTarget` deliberately is not: it is a
 * real Track default (ADR 0041 — "this arena plays well down to four"), so a
 * Survival Round takes whatever the Revision was authored with, and
 * overriding it from the Round type would make that authored number
 * unreachable. `timeLimitMs` is a Track default for the same reason.
 *
 * `"race"` returns an explicit `"respawn"` rather than an empty object: a
 * Track's own default for this field is always the constant `"respawn"`
 * today, so the two agree — but the Lobby's pick is a real choice, and
 * saying so is what keeps it a choice if a Track ever gains an opinion.
 */
export const roundTypeOverrides = (type: RoundType): RoundOverrides =>
  type === "survival" ? { fallBehavior: "eliminate" } : { fallBehavior: "respawn" };

/**
 * Why this Round type cannot start on this Track, in words a Player can
 * read — or `undefined` when it can (M5 ticket 07).
 *
 * Validated at Round start against the Track actually loaded, never by
 * tagging a Track with the Round types it allows (ADR 0041): a tag would be
 * a compatibility matrix to maintain, and re-check against every Revision
 * ever published, the moment a Round type is added or changed. Asking the
 * Track a direct question — "do you have a Finish Zone?" — needs no
 * migration and cannot go stale.
 *
 * Survival has no requirement of its own: it needs no Finish Zone (it does
 * not read one at all — `updateFinishZone` is skipped outright for an
 * eliminating Round), and every Track has ground to be shoved off.
 */
export const roundStartBlockedReason = (type: RoundType, trackHasFinishZone: boolean): string | undefined =>
  type === "race" && !trackHasFinishZone
    ? "This Track has no Finish Zone, so it can't be raced. Pick Survival, or a different Track."
    : undefined;
