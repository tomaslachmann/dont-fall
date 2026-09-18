import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { startApi, type ApiService } from "../app.js";

/**
 * The API's Lobby-socket proxy over real sockets (ADR 0107): a real
 * WebSocket server stands in for a Lobby's Match server, and a client dials
 * it only through the API's `/match/<port>`.
 */
let dir: string;
let api: ApiService;
let lobbyServer: Server;
let lobbyPort: number;
let seenPaths: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-proxy-"));
  seenPaths = [];
  lobbyServer = createServer();
  const wss = new WebSocketServer({ server: lobbyServer });
  wss.on("connection", (socket, req) => {
    seenPaths.push(req.url ?? "");
    socket.on("message", (data) => socket.send(`echo:${String(data)}`));
  });
  await new Promise<void>((resolve) => lobbyServer.listen(0, "127.0.0.1", resolve));
  lobbyPort = (lobbyServer.address() as AddressInfo).port;
  api = await startApi({
    port: 0,
    host: "127.0.0.1",
    dbPath: join(dir, "test.sqlite"),
    maxPlayers: 4,
    lobbies: {
      startMatchServer: async () => ({ port: lobbyPort, close: async () => {} }),
      fetchLobbyStatus: async () => ({ playerCount: 0, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null }),
    },
  });
});

afterEach(async () => {
  await api.close();
  await new Promise<void>((resolve) => lobbyServer.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

const createLobby = async (): Promise<number> => {
  const res = await fetch(`http://127.0.0.1:${api.port}/lobbies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return ((await res.json()) as { port: number }).port;
};

/** Opens `path` on the API as a WebSocket: the first message back, or the refusal's status. */
const dial = (path: string, send = "hi"): Promise<{ message?: string; status?: number }> =>
  new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${api.port}${path}`);
    socket.on("open", () => socket.send(send));
    socket.on("message", (data) => {
      resolve({ message: String(data) });
      socket.close();
    });
    socket.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    socket.on("error", () => resolve({ status: -1 }));
  });

describe("the Lobby-socket proxy (ADR 0107)", () => {
  it("carries a Lobby's socket through the API's own address, query and all", async () => {
    const port = await createLobby();

    expect(await dial(`/match/${port}?track=abc`)).toEqual({ message: "echo:hi" });
    expect(seenPaths).toEqual(["/?track=abc"]);
  });

  it("dials no port a live Lobby does not hold, and nothing but /match/", async () => {
    await createLobby();

    expect(await dial(`/match/${api.port}`)).toEqual({ status: 404 });
    expect(await dial("/tracks")).toEqual({ status: 404 });
    expect(seenPaths).toEqual([]);
  });
});
