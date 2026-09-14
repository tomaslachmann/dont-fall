import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiBaseUrl,
  apiFetch,
  apiGet,
  apiPost,
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "./base.js";

const API = "http://localhost:8081"; // apiBaseUrl() under jsdom

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("apiBaseUrl", () => {
  it("is the single API origin for the serving host", () => {
    expect(apiBaseUrl()).toBe(API);
    expect(apiBaseUrl("example.com")).toBe("http://example.com:8081");
  });
});

describe("stored token", () => {
  it("round-trips through set/get/clear", () => {
    expect(getStoredToken()).toBeNull();
    setStoredToken("tok-1");
    expect(getStoredToken()).toBe("tok-1");
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });
});

describe("apiFetch", () => {
  it("prefixes the path with the base URL", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/tracks");

    expect(fetchMock).toHaveBeenCalledWith(`${API}/tracks`, expect.anything());
  });

  it("attaches the stored token as a Bearer header when there is one, and none otherwise", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/auth/me");
    expect(fetchMock.mock.calls[0]![1]).not.toMatchObject({ headers: expect.objectContaining({ Authorization: expect.anything() }) });

    setStoredToken("tok-1");
    await apiFetch("/auth/me");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ headers: expect.objectContaining({ Authorization: "Bearer tok-1" }) });
  });

  it("throws ApiError rather than leaking fetch's TypeError when the API is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(apiFetch("/tracks")).rejects.toThrow(ApiError);
    await expect(apiFetch("/tracks")).rejects.toThrow(/Could not reach the API/);
  });
});

describe("apiGet / apiPost", () => {
  it("apiPost sends a JSON body and returns the parsed answer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "l1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiPost("/lobbies", { isPrivate: true })).resolves.toEqual({ id: "l1" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/lobbies`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ isPrivate: true }) }),
    );
  });

  it("apiGet returns the parsed answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: "t1" }]), { status: 200 })));

    await expect(apiGet("/tracks")).resolves.toEqual([{ id: "t1" }]);
  });

  it("a non-2xx throws ApiError with the server's own {error} text and status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 409 })));

    const failure = apiGet("/tracks").catch((err: unknown) => err);
    await expect(failure).resolves.toBeInstanceOf(ApiError);
    await expect(failure).resolves.toMatchObject({ message: "nope", status: 409 });
  });

  it("an unreadable body throws ApiError, not a SyntaxError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));

    await expect(apiGet("/tracks")).rejects.toThrow(ApiError);
  });
});
