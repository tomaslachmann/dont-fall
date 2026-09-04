import { DEFAULT_SERVER_PORT, DEFAULT_TRACK_SERVICE_PORT, type WelcomeMessage } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { awaitWelcome, resolveEndpoints } from "./connection.js";

const fakeSocket = () => {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listenerCount: (): number => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    dispatch: (type: string, event: Record<string, unknown> = {}): void => {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type, ...event } as unknown as Event);
    },
    addEventListener: (type: string, listener: EventListener): void => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: EventListener): void => {
      listeners.get(type)?.delete(listener);
    },
  };
};

const welcome: WelcomeMessage = {
  type: "welcome",
  playerId: "p1",
  sessionToken: "token",
  spawn: { x: 0, y: 2, z: 0 },
  trackId: "track-1",
  trackRevision: 3,
  config: { snapshotHz: 15, graceWindowMs: 10_000, playersToStart: 2 },
};

describe("resolveEndpoints", () => {
  it("points the Match server and track-service at the host serving the page", () => {
    const endpoints = resolveEndpoints("example.test");

    expect(endpoints.matchServerUrl).toBe(`ws://example.test:${DEFAULT_SERVER_PORT}/`);
    expect(endpoints.trackServiceUrl).toBe(`http://example.test:${DEFAULT_TRACK_SERVICE_PORT}`);
  });

  it("forwards a Playtest Track onto the Match server connection", () => {
    const endpoints = resolveEndpoints("localhost", "playtest-abc");

    expect(endpoints.matchServerUrl).toBe(`ws://localhost:${DEFAULT_SERVER_PORT}/?track=playtest-abc`);
  });

  it("leaves the connection alone when no Track was asked for", () => {
    expect(resolveEndpoints("localhost").matchServerUrl).not.toContain("track=");
  });
});

describe("awaitWelcome", () => {
  it("resolves with the welcome and leaves no listener on the socket", async () => {
    const socket = fakeSocket();
    const pending = awaitWelcome(socket);

    socket.dispatch("message", { data: JSON.stringify(welcome) });

    await expect(pending).resolves.toEqual(welcome);
    expect(socket.listenerCount()).toBe(0);
  });

  it("waits through other traffic until the welcome arrives", async () => {
    const socket = fakeSocket();
    const pending = awaitWelcome(socket);

    socket.dispatch("message", { data: JSON.stringify({ type: "pong", clientTimeMs: 1, serverTimeMs: 2 }) });
    socket.dispatch("message", { data: JSON.stringify(welcome) });

    await expect(pending).resolves.toEqual(welcome);
  });

  it("rejects when the socket errors before any welcome, rather than hanging on 'connecting…'", async () => {
    const socket = fakeSocket();
    const pending = awaitWelcome(socket);

    socket.dispatch("error");

    await expect(pending).rejects.toThrow(/before the server's welcome/);
    expect(socket.listenerCount()).toBe(0);
  });

  it("surfaces the server's own close reason — a refused Playtest Track says why", async () => {
    const socket = fakeSocket();
    const pending = awaitWelcome(socket);

    socket.dispatch("close", { reason: 'unknown Track "nope"' });

    await expect(pending).rejects.toThrow(/unknown Track "nope"/);
    expect(socket.listenerCount()).toBe(0);
  });

  it("falls back to a generic message when the close carries no reason", async () => {
    const socket = fakeSocket();
    const pending = awaitWelcome(socket);

    socket.dispatch("close", { reason: "" });

    await expect(pending).rejects.toThrow(/closed before the server's welcome/);
  });
});
