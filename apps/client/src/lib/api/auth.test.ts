import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BINDINGS } from "@dont-fall/shared";
import {
  discordAuthorizeUrl,
  fetchAccount,
  login,
  logout,
  parseAuthCallbackFragment,
  saveBindings,
  saveCosmetics,
  signup,
  type Account,
} from "./auth.js";
import { ApiError, setStoredToken } from "./base.js";

const API = "http://localhost:8081"; // apiBaseUrl() under jsdom

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("parseAuthCallbackFragment", () => {
  it("reads a fresh-login token", () => {
    expect(parseAuthCallbackFragment("#token=abc123")).toEqual({ token: "abc123" });
  });

  it("reads a linking-mode success", () => {
    expect(parseAuthCallbackFragment("#linked=discord")).toEqual({ linked: "discord" });
  });

  it("reads a linking-mode error", () => {
    expect(parseAuthCallbackFragment("#error=discord-already-linked")).toEqual({ error: "discord-already-linked" });
  });

  it("works with or without the leading #", () => {
    expect(parseAuthCallbackFragment("token=abc123")).toEqual({ token: "abc123" });
  });

  it("an empty fragment parses to nothing", () => {
    expect(parseAuthCallbackFragment("")).toEqual({});
    expect(parseAuthCallbackFragment("#")).toEqual({});
  });
});

const ACCOUNT: Account = { id: "a1", discordId: "d1", email: null, displayName: "Wobbleton", avatarUrl: null, role: "player", xp: 0, coins: 0, color: 0, skin: null, hat: null, bindings: null };

describe("signup / login", () => {
  it("signup posts the form and returns {account, token}", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ account: ACCOUNT, token: "tok-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await signup({ email: "a@b.com", password: "correct horse battery staple", displayName: "Wobbleton" });

    expect(result).toEqual({ account: ACCOUNT, token: "tok-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/auth/signup`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "a@b.com", password: "correct horse battery staple", displayName: "Wobbleton" }) }),
    );
  });

  it("login posts credentials and returns {account, token}", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ account: ACCOUNT, token: "tok-2" }), { status: 200 })));

    const result = await login({ email: "a@b.com", password: "correct horse battery staple" });

    expect(result).toEqual({ account: ACCOUNT, token: "tok-2" });
  });

  it("a non-2xx response throws ApiError with the server's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid email or password" }), { status: 401 })));

    await expect(login({ email: "a@b.com", password: "wrong" })).rejects.toThrow(ApiError);
    await expect(login({ email: "a@b.com", password: "wrong" })).rejects.toThrow("invalid email or password");
  });
});

describe("fetchAccount", () => {
  it("returns the Account for the stored token, sending it as a Bearer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ACCOUNT), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setStoredToken("tok-1");

    expect(await fetchAccount()).toEqual(ACCOUNT);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/auth/me`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok-1" }) }),
    );
  });

  it("returns null without fetching when there is no stored token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ACCOUNT), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchAccount()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (not an error) for a 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not logged in" }), { status: 401 })));
    setStoredToken("bad-token");

    expect(await fetchAccount()).toBeNull();
  });

  it("throws for any other failure — distinct from 401's null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    setStoredToken("tok-1");

    await expect(fetchAccount()).rejects.toThrow(ApiError);
  });
});

describe("logout", () => {
  it("posts the bearer token to /auth/logout", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    setStoredToken("tok-1");

    await logout();

    expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/logout`, expect.objectContaining({ method: "POST" }));
  });

  it("stays quiet without fetching when there is no stored token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("discordAuthorizeUrl", () => {
  it("points at the API's authorize route", () => {
    expect(discordAuthorizeUrl()).toBe(`${API}/auth/discord/authorize`);
  });
});

describe("saveCosmetics (M9 ticket 15, ADR 0083)", () => {
  it("PUTs the skin and the hat and returns the updated Account", async () => {
    setStoredToken("tok-1");
    const updated = { ...ACCOUNT, color: 3, skin: null, hat: "cone" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(updated), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveCosmetics({ color: 3, skin: null, hat: "cone" })).resolves.toEqual(updated);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/auth/me/cosmetics`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ color: 3, skin: null, hat: "cone" }) }),
    );
  });

  it("sends a taken-off hat as null, and leaves out what isn't being changed", async () => {
    setStoredToken("tok-1");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ACCOUNT), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveCosmetics({ hat: null });

    expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/me/cosmetics`, expect.objectContaining({ body: '{"hat":null}' }));
  });

  it("a refused choice surfaces the server's reason as an ApiError", async () => {
    setStoredToken("tok-1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "UFO unlocks at level 30" }), { status: 403 })));

    await expect(saveCosmetics({ hat: "ufo" })).rejects.toThrow(ApiError);
    await expect(saveCosmetics({ hat: "ufo" })).rejects.toThrow("UFO unlocks at level 30");
  });
});

describe("saveBindings (M9 controls)", () => {
  it("PUTs the whole record and returns the updated Account", async () => {
    setStoredToken("tok-1");
    const bindings = { ...DEFAULT_BINDINGS, hit: ["Mouse0"] };
    const updated = { ...ACCOUNT, bindings };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(updated), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveBindings(bindings)).resolves.toEqual(updated);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/auth/me/bindings`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ bindings }) }),
    );
  });

  it("a malformed record surfaces the server's reason as an ApiError", async () => {
    setStoredToken("tok-1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: 'bindings["hit"] must be an array of controls' }), { status: 400 })));

    await expect(saveBindings({} as never)).rejects.toThrow(ApiError);
    await expect(saveBindings({} as never)).rejects.toThrow('bindings["hit"] must be an array of controls');
  });
});
