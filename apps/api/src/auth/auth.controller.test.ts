import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { DEFAULT_BINDINGS, xpLevelStart } from "@dont-fall/shared";
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

    const res = await save(token, { color: 2 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ color: 2, displayName: "Wobbleton" });
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ color: 2 });
  });

  it("equips the factory base like any skin — id 7 is a choice, not an error", async () => {
    const { token } = (await signup()).json() as { token: string };

    const res = await save(token, { color: 7 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ color: 7 });
  });

  it("refuses an out-of-range skin with a reason naming the fix", async () => {
    const { token } = (await signup()).json() as { token: string };

    const res = await save(token, { color: 8 });

    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/color must be an integer/);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ color: 0 });
  });

  it("refuses nonsense bodies the same way — missing, fractional, wrong type", async () => {
    const { token } = (await signup()).json() as { token: string };

    for (const body of [{}, { color: 1.5 }, { color: "1" }, { color: -1 }]) {
      expect((await save(token, body)).statusCode).toBe(400);
    }
  });

  it("401s without a session — cosmetics need a logged-in Account", async () => {
    expect((await save(undefined, { color: 1 })).statusCode).toBe(401);
    expect((await save("dead-token", { color: 1 })).statusCode).toBe(401);
    expect((await save(undefined, { hat: null })).statusCode).toBe(401);
  });

  describe("hats (ADR 0083)", () => {
    const me = async (token: string) =>
      (await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } })).json() as {
        color: number;
        hat: string | null;
      };
    /** Levels the Account up the way the economy would: its stored XP. */
    const reachLevel = (displayName: string, level: number) => {
      const raw = new Database(join(dir, "test.sqlite"));
      raw.prepare("UPDATE accounts SET xp = ? WHERE display_name = ?").run(xpLevelStart(level), displayName);
      raw.close();
    };

    it("starts every Account with no hat", async () => {
      const { token } = (await signup()).json() as { token: string };
      expect(await me(token)).toMatchObject({ hat: null });
    });

    it("refuses a hat above the Account's level with a 403 naming the level, and wears nothing", async () => {
      const { token } = (await signup()).json() as { token: string };

      const res = await save(token, { hat: "cone" });

      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(res.json())).toMatch(/TRAFFIC CONE unlocks at level 2/);
      expect(await me(token)).toMatchObject({ hat: null });
    });

    it("wears a hat once the level is reached, keeping the skin, and takes it off again", async () => {
      const { token } = (await signup()).json() as { token: string };
      await save(token, { color: 3 });
      reachLevel(SIGNUP.displayName, 2);

      const res = await save(token, { hat: "cone" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ hat: "cone", color: 3 });
      expect(await me(token)).toMatchObject({ hat: "cone", color: 3 });

      expect((await save(token, { hat: null })).json()).toMatchObject({ hat: null, color: 3 });
    });

    it("saves a skin and a hat in one request", async () => {
      const { token } = (await signup()).json() as { token: string };
      reachLevel(SIGNUP.displayName, 30);

      expect((await save(token, { color: 6, skin: null, hat: "ufo" })).json()).toMatchObject({ color: 6, skin: null, hat: "ufo" });
    });

    it("lands nothing when the hat is refused — not even the skin sent with it", async () => {
      const { token } = (await signup()).json() as { token: string };

      expect((await save(token, { color: 4, skin: null, hat: "crown" })).statusCode).toBe(403);
      expect((await save(token, { color: 4, skin: null, hat: "top-hat" })).statusCode).toBe(400);
      expect(await me(token)).toMatchObject({ color: 0, skin: null, hat: null });
    });

    it("refuses anything that isn't a hat id, with a reason listing the hats", async () => {
      const { token } = (await signup()).json() as { token: string };
      reachLevel(SIGNUP.displayName, 30);

      for (const hat of ["Crown", "", 3, {}]) {
        const res = await save(token, { hat });
        expect(res.statusCode).toBe(400);
        expect(JSON.stringify(res.json())).toMatch(/hat must be null or one of/);
      }
    });
  });
});

describe("PUT /auth/me/bindings (M9 controls)", () => {
  const signup = () => app.inject({ method: "POST", url: "/auth/signup", payload: SIGNUP });
  const save = (token: string | undefined, body: unknown) =>
    app.inject({
      method: "PUT",
      url: "/auth/me/bindings",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body as Record<string, unknown>,
    });

  it("stores a full record and returns the updated Account in the one round trip", async () => {
    const { token } = (await signup()).json() as { token: string };
    const bindings = { ...DEFAULT_BINDINGS, hit: ["Mouse0"] };

    const res = await save(token, { bindings });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bindings });
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ bindings });
  });

  it("refuses partial and malformed records with a reason", async () => {
    const { token } = (await signup()).json() as { token: string };
    const { jump: _dropped, ...missing } = DEFAULT_BINDINGS;

    for (const body of [
      {},
      { bindings: missing },
      { bindings: { ...DEFAULT_BINDINGS, hit: ["Escape"] } },
      { bindings: { ...DEFAULT_BINDINGS, fly: ["KeyF"] } },
      { bindings: "KeyW" },
    ]) {
      const res = await save(token, body);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toMatch(/bindings/i);
    }
  });

  it("401s without a session — bindings need a logged-in Account", async () => {
    expect((await save(undefined, { bindings: DEFAULT_BINDINGS })).statusCode).toBe(401);
    expect((await save("dead-token", { bindings: DEFAULT_BINDINGS })).statusCode).toBe(401);
  });
});
