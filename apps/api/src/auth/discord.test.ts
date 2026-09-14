import { describe, expect, it, vi } from "vitest";
import { buildDiscordAuthorizeUrl, exchangeDiscordCode, type DiscordOAuthConfig, type FetchLike } from "./discord.js";

const CONFIG: DiscordOAuthConfig = {
  clientId: "client-123",
  clientSecret: "secret-abc",
  redirectUri: "http://localhost:5175/auth/discord/callback",
};

describe("buildDiscordAuthorizeUrl", () => {
  it("points at Discord's authorize endpoint with client id, redirect uri, and state round-tripped", () => {
    const url = new URL(buildDiscordAuthorizeUrl(CONFIG, "state-xyz"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-xyz");
  });
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("exchangeDiscordCode", () => {
  it("exchanges a code for an access token, then resolves the Discord identity it belongs to", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (url === "https://discord.com/api/oauth2/token") return jsonResponse({ access_token: "at-1" });
      if (url === "https://discord.com/api/users/@me") return jsonResponse({ id: "d-1", username: "Wobbleton", avatar: "abc123" });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const identity = await exchangeDiscordCode(CONFIG, "the-code", fetchImpl);

    expect(identity).toEqual({
      discordId: "d-1",
      displayName: "Wobbleton",
      avatarUrl: "https://cdn.discordapp.com/avatars/d-1/abc123.png",
    });
  });

  it("sends the authorization-code grant with the code, redirect_uri, and client credentials", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (url === "https://discord.com/api/oauth2/token") return jsonResponse({ access_token: "at-1" });
      return jsonResponse({ id: "d-1", username: "Wobbleton", avatar: null });
    });

    await exchangeDiscordCode(CONFIG, "the-code", fetchImpl);

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("the-code");
    expect(sent.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(sent.get("client_id")).toBe(CONFIG.clientId);
    expect(sent.get("client_secret")).toBe(CONFIG.clientSecret);
  });

  it("a null Discord avatar resolves to a null avatarUrl, not a broken CDN link", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (url === "https://discord.com/api/oauth2/token") return jsonResponse({ access_token: "at-1" });
      return jsonResponse({ id: "d-1", username: "Wobbleton", avatar: null });
    });

    const identity = await exchangeDiscordCode(CONFIG, "the-code", fetchImpl);
    expect(identity.avatarUrl).toBeNull();
  });

  it("throws when the token exchange itself fails", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("bad code", { status: 400 }));
    await expect(exchangeDiscordCode(CONFIG, "bad-code", fetchImpl)).rejects.toThrow(/token exchange failed/);
  });

  it("throws when the token response has no access_token", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse({}));
    await expect(exchangeDiscordCode(CONFIG, "the-code", fetchImpl)).rejects.toThrow(/no access_token/);
  });

  it("throws when the /users/@me call fails", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (url === "https://discord.com/api/oauth2/token") return jsonResponse({ access_token: "at-1" });
      return new Response("unauthorized", { status: 401 });
    });
    await expect(exchangeDiscordCode(CONFIG, "the-code", fetchImpl)).rejects.toThrow(/\/users\/@me failed/);
  });
});
