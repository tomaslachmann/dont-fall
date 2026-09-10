import type { DiscordIdentity } from "./accounts.js";

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Where Discord redirects back to after consent — must exactly match the app registered in Discord's dev portal. */
  redirectUri: string;
}

/** Minimal shape this module needs from the global `fetch` — the real one, or a test double. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";

/**
 * The URL the client redirects the browser to start login (ADR 0052:
 * Discord, single provider). `state` is an opaque, caller-chosen value
 * round-tripped by Discord unchanged — CSRF protection is the caller's job
 * (verify the `state` it gets back matches one it issued), not this
 * function's.
 */
export const buildDiscordAuthorizeUrl = (config: DiscordOAuthConfig, state: string): string => {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  return url.toString();
};

class DiscordExchangeError extends Error {}

/**
 * Exchanges an OAuth `code` for the Discord identity it belongs to — the
 * authorization-code-grant token request, then one `/users/@me` call.
 * `fetchImpl` defaults to the real `fetch`; tests inject a double so this
 * runs with no network access and no real Discord app.
 */
export const exchangeDiscordCode = async (
  config: DiscordOAuthConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<DiscordIdentity> => {
  const tokenRes = await fetchImpl(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new DiscordExchangeError(`Discord token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) throw new DiscordExchangeError("Discord token exchange response had no access_token");

  const userRes = await fetchImpl(DISCORD_USER_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userRes.ok) {
    throw new DiscordExchangeError(`Discord /users/@me failed: ${userRes.status} ${await userRes.text()}`);
  }
  const user = (await userRes.json()) as { id?: string; username?: string; avatar?: string | null };
  if (!user.id || !user.username) throw new DiscordExchangeError("Discord /users/@me response missing id/username");

  return {
    discordId: user.id,
    displayName: user.username,
    avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
  };
};
