/**
 * The client's half of the API's Accounts API (M9 ticket 11, ADR
 * 0052/0053) — the OAuth callback fragment and the
 * signup/login/logout/`/auth/me` calls. Pure/fetch-only, no React: `AuthGate`
 * and the auth Screens are the only callers. Origin, token storage, and
 * transport come from the shared base (`api.ts`) — no `baseUrl` threading.
 */
import type { AccountRole, KeyBindings } from "@dont-fall/shared";
import { ApiError, apiBaseUrl, apiFetch, apiJson, apiPost, getStoredToken } from "./base.js";

export interface Account {
  id: string;
  discordId: string | null;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** This Account's role — `"player"` for everyone, `"admin"` reserved. Received, never rendered on (yet). */
  role: AccountRole;
  /** Lifetime match earnings — the economy's persisted half. */
  xp: number;
  coins: number;
  /** The body's equipped color id (M9 ticket 15) — a small int, default bean until picked. Shows only under no `skin`. */
  color: number;
  /** The equipped skin's id (ADR 0091) — `null` for no skin, which is what makes `color` the bean's look. */
  skin: string | null;
  /** The equipped hat's id (ADR 0083) — `null` for no hat. */
  hat: string | null;
  /** The stored key bindings (M9 controls) — `null` when never saved, which resolves to defaults. */
  bindings: KeyBindings | null;
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

/** What one cosmetics save equips — a slot left out keeps what the Account has; `skin`/`hat: null` takes that one off. */
export interface CosmeticsChoice {
  color?: number;
  skin?: string | null;
  hat?: string | null;
}

/**
 * Equips cosmetics (M9 ticket 15, ADR 0083/0091) — PUTs the cosmetics
 * sub-resource and returns the updated Account, so the screen refreshes in
 * the one round trip. Throws `ApiError` like every other authed call: a 400
 * for something that isn't a color, a skin or a hat, a 403 for a skin or
 * hat above the Account's level, a 401 for a dead token.
 */
export const saveCosmetics = async (choice: CosmeticsChoice): Promise<Account> =>
  apiJson<Account>("/auth/me/cosmetics", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(choice),
  });

/**
 * Stores key bindings (M9 controls) — PUTs the whole record and returns the
 * updated Account, so the screen refreshes in the one round trip. Throws
 * `ApiError` (a 400 for a malformed record, 401 for a dead token) like
 * every other authed call.
 */
export const saveBindings = async (bindings: KeyBindings): Promise<Account> =>
  apiJson<Account>("/auth/me/bindings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindings }),
  });
