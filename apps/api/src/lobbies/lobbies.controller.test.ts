import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword, createSession } from "../auth/accounts.dao.js";
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
    // Only a signed-in entry reserves anything (ADR 0112); the anonymous
    // behaviours below never reach this.
    reserveSeats: vi.fn(async (port: number, accountIds: readonly string[]) =>
      Object.fromEntries(accountIds.map((id) => [id, `${port}-${id}`])),
    ),
  };
};

let dir: string;
let db: ApiDb;
let app: FastifyInstance;
let fakes: ReturnType<typeof fakeMatchServers>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-test-"));
  db = openDb(join(dir, "test.sqlite"));
  fakes = fakeMatchServers();
  app = await buildApp({
    db,
    apiUrl: "http://localhost:8081",
    maxPlayers: 4,
    lobbies: {
      startMatchServer: fakes.startMatchServer,
      fetchLobbyStatus: fakes.fetchLobbyStatus,
      reserveSeats: fakes.reserveSeats,
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

const joinLobby = (body: { code?: string; lobbyId?: string }) => app.inject({ method: "POST", url: "/lobbies/join", payload: body });

const makeAccount = (name: string): { id: string; token: string } => {
  const account = createAccountWithPassword(db, { email: `${name}@example.com`, password: "password-123", displayName: name });
  return { id: account.id, token: createSession(db, account.id).token };
};

const auth = (who: { token: string }): { authorization: string } => ({ authorization: `Bearer ${who.token}` });

const quickMatch = (who?: { token: string }) =>
  app.inject({ method: "POST", url: "/lobbies/quick-match", ...(who ? { headers: auth(who) } : {}) });

describe("lobbies", () => {
  it("creates a Lobby and hands its Match server this API's origin", async () => {
    const res = await createLobby();
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; port: number; code: null; isPrivate: boolean };
    expect(body.id).toBeTruthy();
    expect(body.port).toBeGreaterThanOrEqual(61000);
    expect(body.code).toBeNull();
    expect(body.isPrivate).toBe(false);
    expect(fakes.started).toEqual([{ apiUrl: "http://localhost:8081", maxPlayers: 4, reservationSecret: expect.any(String) }]);
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
        { apiUrl: "http://localhost:8081", maxPlayers: 4, portRange: { min: 51000, max: 51099 }, reservationSecret: expect.any(String) },
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

  it("starts a private Lobby at the ROUNDS it was created with, and refuses a length out of range (ADR 0110)", async () => {
    const res = await createLobby({ isPrivate: true, matchLength: 5, privacy: "friends" });
    expect(res.statusCode).toBe(201);
    expect(fakes.started.at(-1)).toMatchObject({ matchLength: 5 });

    expect((await createLobby({ isPrivate: true, matchLength: 99 })).statusCode).toBe(400);
    expect((await createLobby({ isPrivate: true, privacy: "everyone" })).statusCode).toBe(400);
  });

  it("starts a private Lobby with the Bots it was created with, and refuses settings out of range (M17 ticket 10)", async () => {
    const res = await createLobby({ isPrivate: true, bots: { enabled: true, max: 3, level: "hard" } });
    expect(res.statusCode).toBe(201);
    expect(fakes.started.at(-1)).toMatchObject({ bots: { enabled: true, max: 3, level: "hard" } });

    // This broker's Lobbies hold four: three Bots at most beside the host.
    expect((await createLobby({ isPrivate: true, bots: { enabled: true, max: 4, level: "hard" } })).statusCode).toBe(400);
    expect((await createLobby({ isPrivate: true, bots: { enabled: true, max: 1, level: "insane" } })).statusCode).toBe(400);
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

    const res = await joinLobby({ code: created.code });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: created.id, port: created.port });

    const missing = await joinLobby({ code: "NOPE00" });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: string }).error).toContain("NOPE00");
  });

  it("resolves a public Lobby id to its port — private ids and strangers 404", async () => {
    const open = (await createLobby()).json() as { id: string; port: number };
    const priv = (await createLobby({ isPrivate: true })).json() as { id: string };

    const res = await joinLobby({ lobbyId: open.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: open.id, port: open.port });

    expect((await joinLobby({ lobbyId: "no-such-lobby" })).statusCode).toBe(404);
    // Private lobbies resolve by code only — their id alone opens nothing.
    expect((await joinLobby({ lobbyId: priv.id })).statusCode).toBe(404);
  });

  it("refuses an id whose Lobby filled or started — 409, never the port", async () => {
    const created = (await createLobby()).json() as { id: string; port: number };
    fakes.statuses.set(created.port, { playerCount: 4, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });

    const full = await joinLobby({ lobbyId: created.id });
    expect(full.statusCode).toBe(409);
    expect((full.json() as { error: string }).error).toMatch(/no longer joinable/);
  });

  it("refuses a code whose Lobby filled or started — 409, never the port", async () => {
    const created = (await createLobby({ isPrivate: true })).json() as { port: number; code: string };
    fakes.statuses.set(created.port, { playerCount: 4, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });

    const full = await joinLobby({ code: created.code });
    expect(full.statusCode).toBe(409);
    expect((full.json() as { error: string }).error).toMatch(/no longer joinable/);

    fakes.statuses.set(created.port, { playerCount: 0, maxPlayers: 4, phase: "RUNNING", accounts: [], round: 1 });
    expect((await joinLobby({ code: created.code })).statusCode).toBe(409);
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

  it("refuses a burst of entries from one caller with 429, and nobody else's", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");

    // A handful of deliberate clicks go through — the reload-and-try-again a
    // real player makes is well inside this.
    for (let i = 0; i < 5; i += 1) expect((await quickMatch(amy)).statusCode).toBe(200);

    const refused = await quickMatch(amy);
    expect(refused.statusCode).toBe(429);
    expect((refused.json() as { error: string }).error).toMatch(/wait a moment/);
    // Every route the broker is entered through spends the same window, so a
    // loop cannot walk around it: seats it never takes hold the Lobby's Start.
    expect((await app.inject({ method: "POST", url: "/lobbies", headers: auth(amy), payload: {} })).statusCode).toBe(429);
    expect(
      (await app.inject({ method: "POST", url: "/lobbies/join", headers: auth(amy), payload: { lobbyId: "whatever" } })).statusCode,
    ).toBe(429);

    // Another bean, and a caller with no session, enter as usual.
    expect((await quickMatch(bo)).statusCode).toBe(200);
    expect((await quickMatch()).statusCode).toBe(200);
  });

  it("reaps a Lobby nobody joined and closes its Match server", async () => {
    const created = (await createLobby({ isPrivate: true })).json() as { port: number; code: string };
    expect(fakes.closed).toEqual([]);

    await vi.waitFor(
      async () => {
        const res = await joinLobby({ code: created.code });
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
