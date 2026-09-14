import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { LobbyStatus } from "./lobbies.service.js";

/**
 * Fake match-server seam (ADR 0058): no sockets — `startMatchServer` hands
 * out fake ports with scripted statuses, `fetchLobbyStatus` reads them. The
 * behaviours below are the broker's own contract (create/browse/by-code/
 * quick-match/reap), independent of real `MatchServer`s, which keep their
 * own suites in `apps/server`.
 */
const fakeMatchServers = () => {
  let nextPort = 61000;
  const statuses = new Map<number, LobbyStatus>();
  const closed: number[] = [];
  const started: { apiUrl: string; maxPlayers: number; portRange?: { min: number; max: number } }[] = [];
  return {
    statuses,
    closed,
    started,
    startMatchServer: vi.fn(
      async (opts: { apiUrl: string; maxPlayers: number; portRange?: { min: number; max: number } }) => {
      started.push(opts);
      const port = nextPort++;
      statuses.set(port, { playerCount: 0, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
      return {
        port,
        close: async () => {
          closed.push(port);
          statuses.delete(port);
        },
      };
      },
    ),
    fetchLobbyStatus: vi.fn(async (port: number) => statuses.get(port) ?? null),
  };
};

let dir: string;
let app: FastifyInstance;
let fakes: ReturnType<typeof fakeMatchServers>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-test-"));
  fakes = fakeMatchServers();
  app = await buildApp({
    dbPath: join(dir, "test.sqlite"),
    apiUrl: "http://localhost:8081",
    maxPlayers: 4,
    lobbies: {
      startMatchServer: fakes.startMatchServer,
      fetchLobbyStatus: fakes.fetchLobbyStatus,
      statusPollIntervalMs: 20,
      idleGraceMs: 40,
    },
  });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const createLobby = (body: unknown = {}) =>
  app.inject({ method: "POST", url: "/lobbies", payload: body as Record<string, unknown> });

describe("lobbies", () => {
  it("creates a Lobby and hands its Match server this API's origin", async () => {
    const res = await createLobby();
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; port: number; code: null; isPrivate: boolean };
    expect(body.id).toBeTruthy();
    expect(body.port).toBeGreaterThanOrEqual(61000);
    expect(body.code).toBeNull();
    expect(body.isPrivate).toBe(false);
    expect(fakes.started).toEqual([{ apiUrl: "http://localhost:8081", maxPlayers: 4 }]);
  });

  it("hands the configured match port range to the Match server spawn (Docker)", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "api-test-"));
    const fakes2 = fakeMatchServers();
    const app2 = await buildApp({
      dbPath: join(dir2, "test.sqlite"),
      apiUrl: "http://localhost:8081",
      maxPlayers: 4,
      matchPortRange: { min: 51000, max: 51099 },
      lobbies: {
        startMatchServer: fakes2.startMatchServer,
        fetchLobbyStatus: fakes2.fetchLobbyStatus,
        statusPollIntervalMs: 20,
        idleGraceMs: 40,
      },
    });
    try {
      const res = await app2.inject({ method: "POST", url: "/lobbies", payload: {} });
      expect(res.statusCode).toBe(201);
      expect(fakes2.started).toEqual([
        { apiUrl: "http://localhost:8081", maxPlayers: 4, portRange: { min: 51000, max: 51099 } },
      ]);
    } finally {
      await app2.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("a private create returns a join code", async () => {
    const res = await createLobby({ isPrivate: true });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { code: string; isPrivate: boolean };
    expect(body.isPrivate).toBe(true);
    expect(body.code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("lists public Lobbies with live occupancy — private ones never appear", async () => {
    await createLobby();
    await createLobby({ isPrivate: true });

    const res = await app.inject({ method: "GET", url: "/lobbies" });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { id: string; port: number; playerCount: number; maxPlayers: number; phase: string; joinable: boolean }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ playerCount: 0, maxPlayers: 4, phase: "LOBBY", joinable: true });
  });

  it("resolves a join code to its Lobby — unknown codes 404 with a reason", async () => {
    const created = (await createLobby({ isPrivate: true })).json() as { id: string; port: number; code: string };

    const res = await app.inject({ method: "GET", url: `/lobbies/code/${created.code}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: created.id, port: created.port });

    const missing = await app.inject({ method: "GET", url: "/lobbies/code/NOPE00" });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: string }).error).toContain("NOPE00");
  });

  it("resolves a public Lobby id to its port — private ids and strangers 404", async () => {
    const open = (await createLobby()).json() as { id: string; port: number };
    const priv = (await createLobby({ isPrivate: true })).json() as { id: string };

    const res = await app.inject({ method: "GET", url: `/lobbies/${open.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: open.id, port: open.port });

    expect((await app.inject({ method: "GET", url: "/lobbies/no-such-lobby" })).statusCode).toBe(404);
    // Private lobbies resolve by code only — their id alone opens nothing.
    expect((await app.inject({ method: "GET", url: `/lobbies/${priv.id}` })).statusCode).toBe(404);
  });

  it("refuses an id whose Lobby filled or started — 409, never the port", async () => {
    const created = (await createLobby()).json() as { id: string; port: number };
    fakes.statuses.set(created.port, { playerCount: 4, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });

    const full = await app.inject({ method: "GET", url: `/lobbies/${created.id}` });
    expect(full.statusCode).toBe(409);
    expect((full.json() as { error: string }).error).toMatch(/no longer joinable/);
  });

  it("refuses a code whose Lobby filled or started — 409, never the port", async () => {
    const created = (await createLobby({ isPrivate: true })).json() as { port: number; code: string };
    fakes.statuses.set(created.port, { playerCount: 4, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });

    const full = await app.inject({ method: "GET", url: `/lobbies/code/${created.code}` });
    expect(full.statusCode).toBe(409);
    expect((full.json() as { error: string }).error).toMatch(/no longer joinable/);

    fakes.statuses.set(created.port, { playerCount: 0, maxPlayers: 4, phase: "RUNNING", accounts: [], round: 1 });
    expect((await app.inject({ method: "GET", url: `/lobbies/code/${created.code}` })).statusCode).toBe(409);
  });

  it("quick-match reuses an open Lobby, or starts a fresh one when none is open", async () => {
    const first = (await app.inject({ method: "POST", url: "/lobbies/quick-match" })).json() as { id: string };
    const second = (await app.inject({ method: "POST", url: "/lobbies/quick-match" })).json() as { id: string };
    expect(second.id).toBe(first.id);
    expect(fakes.startMatchServer).toHaveBeenCalledTimes(1);

    // Nobody open anymore (a Match started elsewhere) — a fresh one spins up.
    const only = [...fakes.statuses.keys()][0]!;
    fakes.statuses.set(only, { playerCount: 0, maxPlayers: 4, phase: "RUNNING", accounts: [], round: 1 });
    const third = (await app.inject({ method: "POST", url: "/lobbies/quick-match" })).json() as { id: string };
    expect(third.id).not.toBe(first.id);
    expect(fakes.startMatchServer).toHaveBeenCalledTimes(2);
  });

  it("reaps a Lobby nobody joined and closes its Match server", async () => {
    const created = (await createLobby({ isPrivate: true })).json() as { port: number; code: string };
    expect(fakes.closed).toEqual([]);

    await vi.waitFor(
      async () => {
        const res = await app.inject({ method: "GET", url: `/lobbies/code/${created.code}` });
        expect(res.statusCode).toBe(404);
      },
      { timeout: 2000 },
    );
    expect(fakes.closed).toEqual([created.port]);
  });

  it("an occupied Lobby is never reaped, and emptying restarts the grace clock", async () => {
    const created = (await createLobby()).json() as { port: number };
    fakes.statuses.set(created.port, { playerCount: 2, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fakes.closed).toEqual([]);

    fakes.statuses.set(created.port, { playerCount: 0, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
    await vi.waitFor(
      async () => {
        const res = await app.inject({ method: "GET", url: "/lobbies" });
        expect((res.json() as unknown[]).length).toBe(0);
      },
      { timeout: 2000 },
    );
    expect(fakes.closed).toEqual([created.port]);
  });
});
