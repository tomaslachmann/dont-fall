import { invalidBodySkinReason, randomBearerToken } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { parseCookie } from "../http/cookies.js";
import { ServiceError } from "../http/errors.js";
import {
  createAccountWithPassword,
  createSession,
  deleteSession,
  getAccountBySessionToken,
  invalidDisplayNameReason,
  invalidEmailReason,
  invalidPasswordReason,
  isUniqueConstraintError,
  linkDiscordToAccount,
  linkPasswordToAccount,
  setBodySkin,
  upsertAccountFromDiscord,
  verifyEmailPassword,
  type Account,
} from "./accounts.dao.js";
import { buildDiscordAuthorizeUrl, exchangeDiscordCode, type DiscordOAuthConfig, type FetchLike } from "./discord.js";

export type { Account, DiscordOAuthConfig, FetchLike };

const OAUTH_STATE_COOKIE = "df_oauth_state";
/** Set only when `/auth/discord/authorize` is called with a valid session (ADR 0053: linking Discord onto an already-logged-in Account, not a fresh login). */
const OAUTH_LINK_ACCOUNT_COOKIE = "df_oauth_link_account";

export interface DiscordCallbackResult {
  location: string;
  setCookies: string[];
}

/**
 * Starts a Discord login: the authorize URL to redirect to plus the cookies
 * to set (M9 ticket 11, ADR 0052). A caller presenting a valid session is
 * linking Discord onto their existing Account (ADR 0053), not starting a
 * fresh login — the account id rides its own short-lived cookie so the
 * callback can tell the two cases apart. Throws 500 when Discord is not
 * configured (every other route has nothing to do with Accounts and keeps
 * working).
 */
export const beginDiscordLogin = (
  db: ApiDb,
  discord: DiscordOAuthConfig | undefined,
  linkToken: string | undefined,
): { authorizeUrl: string; setCookies: string[] } => {
  if (!discord) throw new ServiceError(500, "Discord OAuth is not configured on this server");
  const state = randomBearerToken(16);
  const cookies = [`${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Max-Age=300; Path=/auth/discord`];
  const linkAccount = linkToken ? getAccountBySessionToken(db, linkToken) : undefined;
  if (linkAccount) cookies.push(`${OAUTH_LINK_ACCOUNT_COOKIE}=${linkAccount.id}; HttpOnly; Max-Age=300; Path=/auth/discord`);
  return { authorizeUrl: buildDiscordAuthorizeUrl(discord, state), setCookies: cookies };
};

/**
 * Finishes a Discord login: verifies CSRF state, exchanges the code,
 * creates/links the Account and session. Returns where to redirect (the
 * client app's `/auth/callback`, token on the URL *fragment* — never a
 * query param, which would leak the Bearer [REDACTED] into logs/proxies/Referer)
 * plus the single-use cookies to clear. Throws 400/502 with the same
 * messages the old route answered.
 */
export const finishDiscordLogin = async (
  db: ApiDb,
  discord: DiscordOAuthConfig | undefined,
  clientAppUrl: string,
  input: { code: string | undefined; state: string | undefined; cookieHeader: string | undefined },
  fetchImpl: FetchLike,
): Promise<DiscordCallbackResult> => {
  if (!discord) throw new ServiceError(500, "Discord OAuth is not configured on this server");
  const cookieState = parseCookie(input.cookieHeader, OAUTH_STATE_COOKIE);
  const linkAccountId = parseCookie(input.cookieHeader, OAUTH_LINK_ACCOUNT_COOKIE);
  if (!input.code) throw new ServiceError(400, "missing ?code");
  if (!input.state || !cookieState || input.state !== cookieState) {
    throw new ServiceError(400, "state mismatch — possible CSRF, or an expired/reused login attempt");
  }
  let identity: Awaited<ReturnType<typeof exchangeDiscordCode>>;
  try {
    identity = await exchangeDiscordCode(discord, input.code, fetchImpl);
  } catch (err) {
    throw new ServiceError(502, `Discord login failed: ${(err as Error).message}`);
  }
  // Clears both single-use cookies now that they've served their purpose, on every exit path below.
  const clearCookies = [
    `${OAUTH_STATE_COOKIE}=; Max-Age=0; Path=/auth/discord`,
    `${OAUTH_LINK_ACCOUNT_COOKIE}=; Max-Age=0; Path=/auth/discord`,
  ];
  const redirectUrl = new URL("/auth/callback", clientAppUrl);
  if (linkAccountId) {
    try {
      linkDiscordToAccount(db, linkAccountId, identity);
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      redirectUrl.hash = "error=discord-already-linked";
      return { location: redirectUrl.toString(), setCookies: clearCookies };
    }
    // Linking, not a fresh login: the caller already holds a valid session
    // token (that's what put `linkAccountId` on the cookie) — no new one issued.
    redirectUrl.hash = "linked=discord";
  } else {
    const account = upsertAccountFromDiscord(db, identity);
    const { token } = createSession(db, account.id);
    redirectUrl.hash = `token=${token}`;
  }
  return { location: redirectUrl.toString(), setCookies: clearCookies };
};

/**
 * Email/password signup (ADR 0053) — creates a brand-new Account. A
 * logged-in caller wanting to *add* a password to their existing (likely
 * Discord-first) Account uses `linkPassword`, not this. Throws 400 naming
 * the invalid field, 409 when the email is taken.
 */
export const signupWithPassword = (
  db: ApiDb,
  input: { email?: unknown; password?: unknown; displayName?: unknown },
): { account: Account; token: string } => {
  const reason =
    invalidEmailReason(input.email) ?? invalidPasswordReason(input.password) ?? invalidDisplayNameReason(input.displayName);
  if (reason) throw new ServiceError(400, reason);
  const body = input as { email: string; password: string; displayName: string };
  let account: Account;
  try {
    account = createAccountWithPassword(db, body);
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    throw new ServiceError(409, "an Account with that email already exists");
  }
  const { token } = createSession(db, account.id);
  return { account, token };
};

/**
 * Email/password login. Deliberately the same 401 for "no such email" and
 * "wrong password" — never lets a caller enumerate registered emails.
 */
export const loginWithPassword = (db: ApiDb, input: { email?: unknown; password?: unknown }): { account: Account; token: string } => {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new ServiceError(400, "email and password are required");
  }
  const account = verifyEmailPassword(db, input.email, input.password);
  if (!account) throw new ServiceError(401, "invalid email or password");
  const { token } = createSession(db, account.id);
  return { account, token };
};

/**
 * Links email/password onto the *already-authenticated* caller's Account
 * (ADR 0053) — the Discord-first counterpart to the authorize route's
 * linking mode. Never creates an Account. Throws 401 without a session,
 * 400 for a bad payload, 409 for a taken email.
 */
export const linkPassword = (
  db: ApiDb,
  token: string | undefined,
  input: { email?: unknown; password?: unknown },
): Account => {
  const account = token ? getAccountBySessionToken(db, token) : undefined;
  if (!account) throw new ServiceError(401, "not logged in");
  const reason = invalidEmailReason(input.email) ?? invalidPasswordReason(input.password);
  if (reason) throw new ServiceError(400, reason);
  const body = input as { email: string; password: string };
  try {
    return linkPasswordToAccount(db, account.id, body);
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    throw new ServiceError(409, "an Account with that email already exists");
  }
};

/** Resolves the caller's session — the mandatory-login gate (ADR 0052). Throws 401 without one. */
export const whoAmI = (db: ApiDb, token: string | undefined): Account => {
  const account = token ? getAccountBySessionToken(db, token) : undefined;
  if (!account) throw new ServiceError(401, "not logged in");
  return account;
};

/**
 * Equips cosmetics (M9 ticket 15) — today just the body skin, the shape
 * already a sub-resource so ticket 13's hats and colors join this same
 * endpoint rather than growing a new one per slot. Returns the updated
 * Account, so the screen refreshes in the one round trip.
 */
export const updateCosmetics = (
  db: ApiDb,
  token: string | undefined,
  input: { bodySkin?: unknown },
): Account => {
  const account = token ? getAccountBySessionToken(db, token) : undefined;
  if (!account) throw new ServiceError(401, "not logged in");
  const reason = invalidBodySkinReason(input.bodySkin);
  if (reason) throw new ServiceError(400, reason);
  const updated = setBodySkin(db, account.id, input.bodySkin as number);
  if (!updated) throw new ServiceError(401, "not logged in");
  return updated;
};

/** Ends a session (logout). Deleting an already-gone/unknown token is a no-op, not an error. */
export const logout = (db: ApiDb, token: string | undefined): void => {
  if (token) deleteSession(db, token);
};
