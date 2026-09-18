/**
 * An Account's role — who may do what with it. `"player"` is everyone;
 * `"admin"` is the second enum reserved for future administration tooling.
 * There is no writer yet: every Account is created a player, and nothing
 * promotes one. Carried on the Account responses so the UI already receives
 * it, but nothing renders on it.
 */
export const ACCOUNT_ROLES = ["player", "admin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Every Account starts here — and anything unreadable falls back here, never up to admin. */
export const DEFAULT_ACCOUNT_ROLE: AccountRole = "player";

/**
 * A stored value into a role — fail-closed: only `"admin"` reads as admin,
 * everything else (including a hand-edited DB's garbage) is a player.
 */
export const resolveAccountRole = (value: unknown): AccountRole => (value === "admin" ? "admin" : "player");
