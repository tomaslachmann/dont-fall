import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";

const DISCORD_CONFIG = { clientId: "client-1", clientSecret: "secret-1", redirectUri: "http://localhost:0/auth/discord/callback" };

const fakeDiscordFetch = vi.fn(async (url: string) => {
  if (url === "https://discord.com/api/oauth2/token") {
    return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
  }
  if (url === "https://discord.com/api/users/@me") {
    return new Response(JSON.stringify({ id: "d-1", username: "Wobbleton", avatar: null }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
});

const SIGNUP = { email: "wobbleton@example.com", password: "correct horse battery staple", displayName: "Wobbleton" };

/** `set-cookie` arrives as one string or many — normalize before asserting. */
const cookiesOf = (res: { headers: unknown }): string[] => {
  const raw = (res.headers as Record<string, string | string[] | undefined>)["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
};
const cookiePair = (setCookie: string): string => setCookie.split(";")[0]!;

let dir: string;
let app: FastifyInstance;

const boot = (options: { discord?: typeof DISCORD_CONFIG; clientAppUrl?: string; discordFetch?: typeof fakeDiscordFetch } = {}) =>
  buildApp({ dbPath: join(dir, "test.sqlite"), ...options });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-test-"));
  app = await buildApp({ dbPath: join(dir, "test.sqlite") });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Discord OAuth / accounts (M9 ticket 11, ADR 0052)", () => {
  it("without Discord configured, /auth/discord/authorize answers 500 rather than crashing the service", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/discord/authorize" });
    expect(res.statusCode).toBe(500);
    // Every unrelated route keeps working — Accounts config is independent of Track storage.
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("/auth/discord/authorize redirects to Discord with a state cookie set", async () => {
    await app.close();
    app = await boot({ discord: DISCORD_CONFIG });

    const res = await app.inject({ method: "GET", url: "/auth/discord/authorize" });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(cookiesOf(res)[0]).toMatch(/^df_oauth_state=/);
  });

  it("a full login: authorize -> callback (state verified) -> /auth/me -> /auth/logout -> /auth/me 401s again", async () => {
    await app.close();
    app = await boot({ discord: DISCORD_CONFIG, clientAppUrl: "http://localhost:5173", discordFetch: fakeDiscordFetch });

    const authorizeRes = await app.inject({ method: "GET", url: "/auth/discord/authorize" });
    const state = new URL(authorizeRes.headers.location!).searchParams.get("state")!;
    const cookie = cookiePair(cookiesOf(authorizeRes)[0]!);

    const callbackRes = await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=the-code&state=${state}`,
      headers: { cookie },
    });
    expect(callbackRes.statusCode).toBe(302);
    const redirectLocation = new URL(callbackRes.headers.location!);
    expect(redirectLocation.origin + redirectLocation.pathname).toBe("http://localhost:5173/auth/callback");
    // The token rides the URL fragment, never a query param (never sent to a server/proxy/Referer).
    expect(redirectLocation.search).toBe("");
    const token = new URLSearchParams(redirectLocation.hash.slice(1)).get("token")!;
    expect(token).toBeTruthy();

    const meRes = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json()).toMatchObject({ discordId: "d-1", displayName: "Wobbleton" });

    expect(
      (await app.inject({ method: "POST", url: "/auth/logout", headers: { authorization: `Bearer ${token}` } })).statusCode,
    ).toBe(204);

    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } })).statusCode,
    ).toBe(401);
  });

  it("the callback rejects a state that doesn't match the cookie (CSRF protection)", async () => {
    await app.close();
    app = await boot({ discord: DISCORD_CONFIG, discordFetch: fakeDiscordFetch });

    const authorizeRes = await app.inject({ method: "GET", url: "/auth/discord/authorize" });
    const cookie = cookiePair(cookiesOf(authorizeRes)[0]!);

    const callbackRes = await app.inject({
      method: "GET",
      url: "/auth/discord/callback?code=the-code&state=not-the-real-state",
      headers: { cookie },
    });
    expect(callbackRes.statusCode).toBe(400);
  });

  it("the callback rejects a missing state cookie (no prior /authorize visit)", async () => {
    await app.close();
    app = await boot({ discord: DISCORD_CONFIG, discordFetch: fakeDiscordFetch });

    const res = await app.inject({ method: "GET", url: "/auth/discord/callback?code=the-code&state=anything" });
    expect(res.statusCode).toBe(400);
  });

  it("/auth/me with no Bearer [REDACTED] answers 401", async () => {
    expect((await app.inject({ method: "GET", url: "/auth/me" })).statusCode).toBe(401);
  });

  it("/auth/me with an unknown/garbage Bearer [REDACTED] answers 401", async () => {
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer [REDACTED]" } })).statusCode).toBe(
      401,
    );
  });
});

describe("Email/password auth + linking (M9 ticket 11 follow-up, ADR 0053)", () => {
  const signup = () => app.inject({ method: "POST", url: "/auth/signup", payload: SIGNUP });
  const login = (body: unknown) => app.inject({ method: "POST", url: "/auth/login", payload: body as Record<string, unknown> });

  it("signs up, returns the Account plus a token, and /auth/me resolves it back", async () => {
    const res = await signup();
    expect(res.statusCode).toBe(201);
    const { account, token } = res.json() as { account: { displayName: string; email: string }; token: string };
    expect(account).toMatchObject({ displayName: "Wobbleton", email: SIGNUP.email });
    expect(token).toBeTruthy();

    const meRes = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json()).toMatchObject({ displayName: "Wobbleton", email: SIGNUP.email });
  });

  it("rejects an already-registered email with 409, and garbage input with 400", async () => {
    expect((await signup()).statusCode).toBe(201);
    expect((await signup()).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "not-an-email" } })).statusCode).toBe(400);
  });

  it("logs in with email/password, stores the token, and lands on the Main Menu", async () => {
    await signup();

    const res = await login({ email: SIGNUP.email, password: SIGNUP.password });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    const meRes = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(meRes.statusCode).toBe(200);
  });

  it("rejects a wrong password with 401 — never telling whether the email exists", async () => {
    await signup();

    const res = await login({ email: SIGNUP.email, password: "wrong password" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid payload with 400, not 401", async () => {
    const res = await login({ email: SIGNUP.email });
    expect(res.statusCode).toBe(400);
  });

  it("a second signup for the same email never creates a second Account", async () => {
    const first = (await signup()).json() as { account: { id: string } };
    const second = await signup();
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: string }).error).toMatch(/already exists/);
    expect(first.account.id).toBeTruthy();
  });

  it("links Discord onto a logged-in password Account (authorize with a session, then callback)", async () => {
    await app.close();
    app = await boot({ discord: DISCORD_CONFIG, clientAppUrl: "http://localhost:5173", discordFetch: fakeDiscordFetch });

    const { token } = (await signup()).json() as { token: string };
    const authorizeRes = await app.inject({
      method: "GET",
      url: "/auth/discord/authorize",
      headers: { authorization: `Bearer ${token}` },
    });
    const state = new URL(authorizeRes.headers.location!).searchParams.get("state")!;
    const cookie = cookiesOf(authorizeRes).map(cookiePair).join("; ");

    const callbackRes = await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=the-code&state=${state}`,
      headers: { cookie },
    });
    expect(callbackRes.statusCode).toBe(302);
    const redirectLocation = new URL(callbackRes.headers.location!);
    // Linking: no fresh token issued — the caller keeps their own session.
    expect(new URLSearchParams(redirectLocation.hash.slice(1)).get("linked")).toBe("discord");

    // The same Account now carries both methods: email still logs in.
    expect((await login({ email: SIGNUP.email, password: SIGNUP.password })).statusCode).toBe(200);
  });

  it("linking a Discord id that belongs to someone else's Account refuses cleanly", async () => {
    await app.close();
    app = await boot({ discord: DISCORD_CONFIG, clientAppUrl: "http://localhost:5173", discordFetch: fakeDiscordFetch });

    // Somebody else's Account already owns this Discord id (fresh login, no session).
    const freshAuthorize = await app.inject({ method: "GET", url: "/auth/discord/authorize" });
    const freshState = new URL(freshAuthorize.headers.location!).searchParams.get("state")!;
    await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=the-code&state=${freshState}`,
      headers: { cookie: cookiePair(cookiesOf(freshAuthorize)[0]!) },
    });

    // Now the password Account tries to link the same Discord id.
    const { token } = (await signup()).json() as { token: string };
    const authorizeRes = await app.inject({
      method: "GET",
      url: "/auth/discord/authorize",
      headers: { authorization: `Bearer ${token}` },
    });
    const state = new URL(authorizeRes.headers.location!).searchParams.get("state")!;
    const callbackRes = await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=the-code&state=${state}`,
      headers: { cookie: cookiesOf(authorizeRes).map(cookiePair).join("; ") },
    });
    expect(callbackRes.statusCode).toBe(302);
    expect(new URLSearchParams(new URL(callbackRes.headers.location!).hash.slice(1)).get("error")).toBe(
      "discord-already-linked",
    );
  });

  it("links email/password onto a logged-in Discord Account (/auth/link/password)", async () => {
    await app.close();
    app = await boot({ discord: DISCORD_CONFIG, clientAppUrl: "http://localhost:5173", discordFetch: fakeDiscordFetch });

    const authorizeRes = await app.inject({ method: "GET", url: "/auth/discord/authorize" });
    const state = new URL(authorizeRes.headers.location!).searchParams.get("state")!;
    const callbackRes = await app.inject({
      method: "GET",
      url: `/auth/discord/callback?code=the-code&state=${state}`,
      headers: { cookie: cookiePair(cookiesOf(authorizeRes)[0]!) },
    });
    const discordToken = new URLSearchParams(new URL(callbackRes.headers.location!).hash.slice(1)).get("token")!;

    // No session, no link.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/link/password",
          payload: { email: SIGNUP.email, password: SIGNUP.password },
        })
      ).statusCode,
    ).toBe(401);

    const linkRes = await app.inject({
      method: "POST",
      url: "/auth/link/password",
      headers: { authorization: `Bearer ${discordToken}` },
      payload: { email: SIGNUP.email, password: SIGNUP.password },
    });
    expect(linkRes.statusCode).toBe(200);
    expect((linkRes.json() as { email: string }).email).toBe(SIGNUP.email);

    // And the linked password logs in on its own now.
    expect((await login({ email: SIGNUP.email, password: SIGNUP.password })).statusCode).toBe(200);
  });
});

describe("PUT /auth/me/cosmetics (M9 ticket 15)", () => {
  const signup = () => app.inject({ method: "POST", url: "/auth/signup", payload: SIGNUP });
  const save = (token: string | undefined, body: unknown) =>
    app.inject({
      method: "PUT",
      url: "/auth/me/cosmetics",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body as Record<string, unknown>,
    });

  it("equips a free skin and returns the updated Account in the one round trip", async () => {
    const { token } = (await signup()).json() as { token: string };

    const res = await save(token, { bodySkin: 2 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bodySkin: 2, displayName: "Wobbleton" });
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ bodySkin: 2 });
  });

  it("equips the factory base like any skin — id 7 is a choice, not an error", async () => {
    const { token } = (await signup()).json() as { token: string };

    const res = await save(token, { bodySkin: 7 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bodySkin: 7 });
  });

  it("refuses an out-of-range skin with a reason naming the fix", async () => {
    const { token } = (await signup()).json() as { token: string };

    const res = await save(token, { bodySkin: 8 });

    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/bodySkin must be an integer/);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ bodySkin: 0 });
  });

  it("refuses nonsense bodies the same way — missing, fractional, wrong type", async () => {
    const { token } = (await signup()).json() as { token: string };

    for (const body of [{}, { bodySkin: 1.5 }, { bodySkin: "1" }, { bodySkin: -1 }]) {
      expect((await save(token, body)).statusCode).toBe(400);
    }
  });

  it("401s without a session — cosmetics need a logged-in Account", async () => {
    expect((await save(undefined, { bodySkin: 1 })).statusCode).toBe(401);
    expect((await save("dead-token", { bodySkin: 1 })).statusCode).toBe(401);
  });
});
