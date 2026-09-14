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
export interface AccountResolver {
  resolveAccount: (token: string) => Promise<string | null>;
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
      const account = (await res.json()) as { id?: unknown };
      if (typeof account.id !== "string" || account.id.length === 0) {
        console.error("DON'T FALL: account resolution malformed, connection stays anonymous");
        return null;
      }
      return account.id;
    } catch (err) {
      console.error("DON'T FALL: account resolution unreachable, connection stays anonymous", err);
      return null;
    }
  },
});
