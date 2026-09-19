import { afterEach, describe, expect, it, vi } from "vitest";
import { createLobby, lobbyByCode, lobbyById, lobbyPath, quickMatch, resolveLobbyRef } from "./lobbyBroker.js";

const BROKER = "http://localhost:8081"; // the single API (ADR 0058)

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLobby", () => {
  it("asks the broker for a private Lobby and returns its port and join code", async () => {
    const fetchMock = respond(201, { id: "l1", port: 51234, code: "PLUMJA", isPrivate: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createLobby(true)).resolves.toEqual({ id: "l1", port: 51234, code: "PLUMJA" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BROKER}/lobbies`);
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ isPrivate: true });
  });

  it("carries no code for a public Lobby, which is found by quick-match instead", async () => {
    vi.stubGlobal("fetch", respond(201, { id: "l1", port: 51234, code: null, isPrivate: false }));

    await expect(createLobby(false)).resolves.toEqual({ id: "l1", port: 51234 });
  });
});

describe("lobbyByCode", () => {
  it("upper-cases and trims the typed code before asking", async () => {
    const fetchMock = respond(200, { id: "l1", port: 51234 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(lobbyByCode(" plumja ")).resolves.toEqual({ id: "l1", port: 51234, code: "PLUMJA" });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BROKER}/lobbies/code/PLUMJA`);
  });

  it("surfaces the broker's own reason an unknown code failed, not a generic one", async () => {
    vi.stubGlobal("fetch", respond(404, { error: 'no Lobby with code "ZZZZZZ"' }));

    await expect(lobbyByCode("ZZZZZZ")).rejects.toThrow('no Lobby with code "ZZZZZZ"');
  });

  it("surfaces the broker's reason a Lobby is no longer joinable (409)", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "that Lobby is no longer joinable — full, or its Match already started" }));

    await expect(lobbyByCode("PLUMJA")).rejects.toThrow(/no longer joinable/);
  });
});

describe("quick-match", () => {
  it("POSTs and returns whichever Lobby the broker picked", async () => {
    const fetchMock = respond(200, { id: "l7", port: 61000 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(quickMatch()).resolves.toEqual({ id: "l7", port: 61000 });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BROKER}/lobbies/quick-match`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST" });
  });

  it("says the service is unreachable rather than leaking a TypeError from fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(quickMatch()).rejects.toThrow(/Could not reach the lobby service/);
  });

  it("refuses an answer with no Lobby in it rather than navigating to a port of NaN", async () => {
    vi.stubGlobal("fetch", respond(200, { id: "l7" }));

    await expect(quickMatch()).rejects.toThrow(/without a Lobby to connect to/);
  });
});

describe("lobbyById / resolveLobbyRef", () => {
  it("resolves a public id off GET /lobbies/:id", async () => {
    const fetchMock = respond(200, { id: "l7", port: 61000 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(lobbyById("l7")).resolves.toEqual({ id: "l7", port: 61000 });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BROKER}/lobbies/l7`);
  });

  it("routes private refs by code and public refs by id", async () => {
    const fetchMock = respond(200, { id: "l1", port: 61000 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveLobbyRef({ kind: "private", code: "PLUMJA" })).resolves.toMatchObject({ port: 61000 });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BROKER}/lobbies/code/PLUMJA`);

    await expect(resolveLobbyRef({ kind: "public", lobbyId: "l7" })).resolves.toMatchObject({ port: 61000 });
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BROKER}/lobbies/l7`);
  });

  it("surfaces the broker's reason a friend's Lobby stopped being joinable", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "that Lobby is no longer joinable" }));

    await expect(resolveLobbyRef({ kind: "public", lobbyId: "l7" })).rejects.toThrow(
      "that Lobby is no longer joinable",
    );
  });
});

describe("lobbyPath", () => {
  it("carries the port and the broker's id always, the code only when the Lobby has one", () => {
    expect(lobbyPath({ id: "l1", port: 61000 })).toBe("/lobby?port=61000&id=l1");
    expect(lobbyPath({ id: "l1", port: 61000, code: "PLUMJA" })).toBe("/lobby?port=61000&code=PLUMJA&id=l1");
  });
});
