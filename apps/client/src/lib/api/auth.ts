/**
 * The client's half of the API's Accounts API (M9 ticket 11, ADR
 * 0052/0053) — the OAuth callback fragment and the
 * signup/login/logout/`/auth/me` calls. Pure/fetch-only, no React: `AuthGate`
 * and the auth Screens are the only callers. Origin, token storage, and
 * transport come from the shared base (`api.ts`) — no `baseUrl` threading.
 */
import { ApiError, apiBaseUrl, apiFetch, apiPost, getStoredToken } from "./base.js";

export interface Account {
  id: string;
  discordId: string | null;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Lifetime match earnings — the economy's persisted half. */
  xp: number;
  coins: number;
}

export interface AuthCallbackResult {
  /** A fresh login — store it. */
  token?: string;
  /** Linking mode succeeded (`"discord"` today; the method just linked) — no new token, the caller already had a session. */
  linked?: string;
  /** Linking mode failed (e.g. `"discord-already-linked"`) — nothing to store. */
  error?: string;
}

/**
 * Parses the API's `/auth/discord/callback` redirect fragment
 * (`index.ts`: `#token=...` / `#linked=discord` / `#error=...`) — a
 * fragment, not a query string, so it never reached a server or a Referer
 * header on the way here.
 */
export const parseAuthCallbackFragment = (hash: string): AuthCallbackResult => {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const result: AuthCallbackResult = {};
  const token = params.get("token");
  const linked = params.get("linked");
  const error = params.get("error");
  if (token) result.token = token;
  if (linked) result.linked = linked;
  if (error) result.error = error;
  return result;
};

export const signup = (input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ account: Account; token: string }> => apiPost("/auth/signup", input);

export const login = (input: { email: string; password: string }): Promise<{ account: Account; token: string }> =>
  apiPost("/auth/login", input);

/** Ends the stored session. Quiet when there is none — logging out twice is not an error. */
export const logout = async (): Promise<void> => {
  if (!getStoredToken()) return;
  await apiFetch("/auth/logout", { method: "POST" });
};

/**
 * Resolves a bearer token to the Account it authenticates. `null` for "not
 * logged in" (a 401 — expired or unknown token), distinct from a thrown
 * `ApiError`/network failure, which means the API itself couldn't
 * be reached — the caller (`useAccount`) treats both as "not authed" but the
 * distinction is real for anyone debugging why.
 */
export const fetchAccount = async (): Promise<Account | null> => {
  if (!getStoredToken()) return null;
  const res = await apiFetch("/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError(`GET /auth/me failed: ${res.status}`, res.status);
  return (await res.json()) as Account;
};

/** Where the "Log in with Discord" button sends the browser — the API does the whole OAuth dance and redirects back to `/auth/callback`. */
export const discordAuthorizeUrl = (): string => `${apiBaseUrl()}/auth/discord/authorize`;
