import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { recordBeat } from "../friends/friends.dao.js";
import type { LobbyStatus } from "../lobbies/lobbies.service.js";

/**
 * `GET /game-settings` through the real `buildApp` wiring — the lobbies get
 * the same fake match-server seam as `lobbies.controller.test.ts`, and the
 * online count is the real heartbeat count (ADR 0110), not a stubbed number.
 */
const fakeMatchServers = () => {
  let nextPort = 62000;
  const statuses = new Map<number, LobbyStatus>();
  return {
    statuses,
    startMatchServer: vi.fn(async () => {
      const port = nextPort++;
      statuses.set(port, { playerCount: 0, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
      return { port, close: async () => void statuses.delete(port) };
    }),
    fetchLobbyStatus: vi.fn(async (port: number) => statuses.get(port) ?? null),
  };
};

let dir: string;
let db: ApiDb;
let app: FastifyInstance;
let fakes: ReturnType<typeof fakeMatchServers>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-settings-test-"));
  db = openDb(join(dir, "test.sqlite"));
  fakes = fakeMatchServers();
  app = await buildApp({
    db,
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

describe("GET /game-settings", () => {
  it("names the configured cap and zero beans online with no Lobbies", async () => {
    const res = await app.inject({ method: "GET", url: "/game-settings" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ maxPlayers: 4, onlinePlayers: 0 });
  });

  it("counts signed-in Accounts by their presence heartbeat, in a Lobby or not (ADR 0110)", async () => {
    const beat = async (email: string) => {
      const signup = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "correct horse battery staple", displayName: email.split("@")[0] },
      });
      const { account } = signup.json() as { account: { id: string } };
      // The Account socket's beat (ADR 0112) — its own suite proves the socket writes it.
      recordBeat(db, account.id, Date.now());
    };
    await beat("amy@example.com");
    await beat("bo@example.com");

    const res = await app.inject({ method: "GET", url: "/game-settings" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ maxPlayers: 4, onlinePlayers: 2 });
  });
});
