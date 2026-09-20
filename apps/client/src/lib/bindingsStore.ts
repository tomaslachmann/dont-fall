import { resolveBindings, storedBindings, type KeyBindings } from "@dont-fall/shared";
import { getStoredToken } from "./api/base.js";

/**
 * The bindings' local half (M9 controls): a per-Account localStorage mirror
 * plus the rule that picks the winner. Guests persist here alone; authed
 * players persist to the API, and the mirror keeps their last record for
 * the next boot's first frames (and for offline ones).
 */

/** `dontfall.bindings.v1:<accountId>` — guests share the `guest` lane. The `v1` restarts cleanly if the shape ever changes. */
export const bindingsStorageKey = (accountId: string | null): string => `dontfall.bindings.v1:${accountId ?? "guest"}`;

/**
 * The mirrored record, or `null` when nothing was ever stored — corrupt JSON
 * reads as absent, never throws. `storedBindings`, so a mirror written before
 * an action existed is read rather than thrown away (ADR 0111); see the
 * API's `toBindings`, which had the same trap.
 */
export const readStoredBindings = (accountId: string | null): KeyBindings | null => {
  try {
    const raw = localStorage.getItem(bindingsStorageKey(accountId));
    if (!raw) return null;
    return storedBindings(JSON.parse(raw));
  } catch {
    return null;
  }
};

/** Mirrors a record locally. Quiet on failure (private mode, quota) — the session simply keeps it in memory. */
export const writeStoredBindings = (accountId: string | null, bindings: KeyBindings): void => {
  try {
    localStorage.setItem(bindingsStorageKey(accountId), JSON.stringify(bindings));
  } catch {
    // Session-only then; nothing honest to report to the player mid-game.
  }
};

/**
 * The bindings to play with: the Account's stored record wins, then that
 * Account's own mirror, then defaults. A guest's mirror never leaks onto an
 * Account (and an Account's customs never leak onto guests) — each lane
 * starts from defaults until it saves something of its own.
 */
export const resolveEffectiveBindings = (
  account: { id: string; bindings: KeyBindings | null } | null,
): KeyBindings => {
  if (account?.bindings) return resolveBindings(account.bindings);
  return resolveBindings(readStoredBindings(account?.id ?? null));
};

/**
 * The bindings to boot the game with, before the Account resolves: the
 * guest mirror for guests, plain defaults for a stored login. An authed
 * player must never play the first frames on another lane's customs — the
 * Account record lands live a moment later, through `setBindings`.
 */
export const loadBootBindings = (): KeyBindings =>
  getStoredToken() ? resolveBindings(null) : resolveEffectiveBindings(null);
