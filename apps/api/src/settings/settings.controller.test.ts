import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { LobbyStatus } from "../lobbies/lobbies.service.js";

/**
 * `GET /game-settings` through the real `buildApp` wiring — the same fake
 * match-server seam as `lobbies.controller.test.ts`: scripted per-port
 * statuses, so the online count is the sum the production
 * `LobbiesService.countOnlinePlayers` computes, not a stubbed number.
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
let app: FastifyInstance;
let fakes: ReturnType<typeof fakeMatchServers>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-settings-test-"));
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

describe("GET /game-settings", () => {
  it("names the configured cap and zero beans online with no Lobbies", async () => {
    const res = await app.inject({ method: "GET", url: "/game-settings" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ maxPlayers: 4, onlinePlayers: 0 });
  });

  it("sums seated Players across public and private Lobbies", async () => {
    const first = (await app.inject({ method: "POST", url: "/lobbies", payload: { isPrivate: false } })).json() as { port: number };
    const second = (await app.inject({ method: "POST", url: "/lobbies", payload: { isPrivate: true } })).json() as { port: number };
    fakes.statuses.set(first.port, { playerCount: 3, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
    fakes.statuses.set(second.port, { playerCount: 2, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });

    const res = await app.inject({ method: "GET", url: "/game-settings" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ maxPlayers: 4, onlinePlayers: 5 });
  });

  it("counts a dead Lobby as zero online, not a 500", async () => {
    const created = (await app.inject({ method: "POST", url: "/lobbies", payload: {} })).json() as { port: number };
    fakes.statuses.delete(created.port); // the Match server died without telling the registry

    const res = await app.inject({ method: "GET", url: "/game-settings" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ maxPlayers: 4, onlinePlayers: 0 });
  });
});
