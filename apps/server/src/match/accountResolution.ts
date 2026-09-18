/**
 * The match server's half of account-aware sockets (M9 ticket 11 phase 2b):
 * it resolves the session token a connecting client sends in `auth` against
 * the API's own `/auth/me` — the same opaque Bearer [REDACTED] the API's routes
 * verify, the same `trackServiceUrl` every other server→API call uses.
 *
 * Resolution is enrichment, never a gate: an invalid token, a malformed
 * payload, or a down API resolves to `null` (anonymous connection) instead
 * of throwing — the Match plays on, only friends presence and RECENT lose
 * attribution for that seat. Failures log, never throw.
 */
export interface ResolvedAccount {
  accountId: string;
  /**
   * The Account's display name (ADR 0097) — what the Lobby roster shows this
   * seat as. `null` when the payload carries none, which leaves the seat on
   * whatever name it joined with. Comes from this same `/auth/me` response,
   * which has always carried it; before ADR 0097 the client round-tripped it
   * back over the socket instead.
   */
  displayName: string | null;
  /**
   * The body's equipped color id (M9 ticket 15) — bound from this same
   * response, so cosmetics cost no second round trip. `null` when the
   * payload carries none (an older API, a hand-made mock): the seat plays
   * in the default color. Never range-checked here — the API validated on
   * write, and future unlocks must flow through untouched.
   */
  color: number | null;
  /**
   * The equipped skin's id (ADR 0091), from the same response. `null` for
   * no skin — the bean then wears its `color` — and for a payload without
   * one. Passed through unchecked, for the same reason as `hat`.
   */
  skin: string | null;
  /**
   * The equipped hat's id (ADR 0083), from the same response. `null` for no
   * hat, and for a payload without one. Passed through unchecked like
   * `color`: the API checked it on write, and a client draws no hat for an
   * id it doesn't know.
   */
  hat: string | null;
}

export interface AccountResolver {
  resolveAccount: (token: string) => Promise<ResolvedAccount | null>;
}

export const httpAccountResolver = (apiUrl: string, fetchFn: typeof fetch = fetch): AccountResolver => ({
  resolveAccount: async (token) => {
    try {
      const res = await fetchFn(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error(`DON'T FALL: account resolution refused (${res.status}), connection stays anonymous`);
        return null;
      }
      const account = (await res.json()) as {
        id?: unknown;
        displayName?: unknown;
        color?: unknown;
        skin?: unknown;
        hat?: unknown;
      };
      if (typeof account.id !== "string" || account.id.length === 0) {
        console.error("DON'T FALL: account resolution malformed, connection stays anonymous");
        return null;
      }
      return {
        accountId: account.id,
        displayName: typeof account.displayName === "string" && account.displayName.trim().length > 0 ? account.displayName : null,
        color: typeof account.color === "number" && Number.isFinite(account.color) ? account.color : null,
        skin: typeof account.skin === "string" ? account.skin : null,
        hat: typeof account.hat === "string" ? account.hat : null,
      };
    } catch (err) {
      console.error("DON'T FALL: account resolution unreachable, connection stays anonymous", err);
      return null;
    }
  },
});
