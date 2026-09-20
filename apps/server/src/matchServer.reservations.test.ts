import { PARTY_MAX_SIZE, type ClientMessage, type ServerMessage } from "@dont-fall/shared";
import { startApi, type ApiService } from "@dont-fall/api";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { RESERVATION_SECRET_HEADER, startServer, type MatchServer, type StartServerConfig } from "./matchServer.js";

// Reservations (ADR 0112) over the real wire: the broker's `POST
// /reservations`, a client's `?reservation=` connect, and the Lobby's start
// waiting for the beans still arriving. `startServer` fetches its boot Track
// from the API before it binds (ADR 0028).
let api: ApiService;

beforeAll(async () => {
  api = await startApi({ port: 0, dbPath: ":memory:" });
  process.env.TRACK_SERVICE_URL = `http://localhost:${api.port}`;
});

afterAll(async () => {
  await api.close();
  delete process.env.TRACK_SERVICE_URL;
});

let server: MatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const SECRET = "reservations-test-secret";

/** One Round, so a started Match draws nothing further from the API. */
const start = async (config: StartServerConfig = {}): Promise<MatchServer> => {
  server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0, matchLengthOverride: 1, reservationSecret: SECRET, ...config });
  return server;
};

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

const reserve = (port: number, body: unknown, secret: string | null = SECRET): Promise<Response> =>
  fetch(`http://localhost:${port}/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { [RESERVATION_SECRET_HEADER]: secret }) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Reserves and returns the tokens, failing the test on anything but a grant. */
const reserveTokens = async (port: number, accountIds: string[]): Promise<Record<string, string>> => {
  const res = await reserve(port, { accountIds });
  expect(res.status).toBe(200);
  return ((await res.json()) as { reservations: Record<string, string> }).reservations;
};

const playerCount = async (port: number): Promise<number> =>
  ((await (await fetch(`http://localhost:${port}/status`)).json()) as { playerCount: number }).playerCount;

const connect = (port: number, reservation?: string): WebSocket =>
  new WebSocket(`ws://localhost:${port}${reservation === undefined ? "" : `/?reservation=${encodeURIComponent(reservation)}`}`);

const nextMessage = (socket: WebSocket): Promise<ServerMessage> =>
  new Promise((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as ServerMessage)));

const nextClose = (socket: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));

const snapshotUntil = (socket: WebSocket, predicate: (s: Snapshot) => boolean): Promise<Snapshot> =>
  new Promise((resolve) => {
    const onMessage = (raw: Buffer): void => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.type !== "snapshot" || !predicate(message)) return;
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });

const send = (socket: WebSocket, message: ClientMessage): void => socket.send(JSON.stringify(message));

/** Connected and welcomed. */
const join = async (port: number, reservation?: string): Promise<WebSocket> => {
  const socket = connect(port, reservation);
  const welcome = await nextMessage(socket);
  expect(welcome.type).toBe("welcome");
  return socket;
};

/** Connected and welcomed, keeping the id the Lobby knows this seat by. */
const joinAs = async (port: number, reservation?: string): Promise<{ socket: WebSocket; playerId: string }> => {
  const socket = connect(port, reservation);
  const welcome = await nextMessage(socket);
  if (welcome.type !== "welcome") throw new Error(`expected a welcome, got ${welcome.type}`);
  return { socket, playerId: welcome.playerId };
};

describe("POST /reservations — who may ask (ADR 0112)", () => {
  it("does not exist on a server started without a secret", async () => {
    server = await startServer({ port: 0, playersToStart: 1, countdownMs: 0 });
    const { port } = server;

    expect((await reserve(port, { accountIds: ["a"] })).status).toBe(404);
  });

  it("answers 401 to a missing or wrong secret, and keeps no seat", async () => {
    const { port } = await start();

    expect((await reserve(port, { accountIds: ["a"] }, null)).status).toBe(401);
    expect((await reserve(port, { accountIds: ["a"] }, "not-the-secret")).status).toBe(401);
    expect(await playerCount(port)).toBe(0);
  });

  it("answers 400 to anything but 1 to PARTY_MAX_SIZE distinct Account ids", async () => {
    const { port } = await start();
    const tooMany = Array.from({ length: PARTY_MAX_SIZE + 1 }, (_, i) => `account-${i}`);

    for (const body of ["not json", {}, [], { accountIds: [] }, { accountIds: [1] }, { accountIds: [""] }, { accountIds: ["a", "a"] }, { accountIds: tooMany }]) {
      expect((await reserve(port, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await playerCount(port)).toBe(0);
  });
});

describe("POST /reservations — all or none (ADR 0112)", () => {
  it("gives every Account its own token, each counted by /status as taken", async () => {
    const { port } = await start();
    await join(port);

    const tokens = await reserveTokens(port, ["a", "b"]);

    expect(Object.keys(tokens).sort()).toEqual(["a", "b"]);
    expect(tokens.a).not.toBe(tokens.b);
    expect(await playerCount(port)).toBe(3);
  });

  it("refuses a Party the connections and the seats already kept leave no room for, and keeps none of it", async () => {
    const { port } = await start({ maxPlayers: 3 });
    await join(port);
    await reserveTokens(port, ["a"]);

    const refused = await reserve(port, { accountIds: ["b", "c"] });

    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/no room/);
    expect(await playerCount(port)).toBe(2);
    // One fits, and fills it.
    await reserveTokens(port, ["b"]);
    expect(await playerCount(port)).toBe(3);
  });

  it("refuses once the Lobby's Match has started", async () => {
    const { port } = await start();
    const host = await join(port);
    send(host, { type: "setReady", ready: true });
    await snapshotUntil(host, (s) => s.lobby.players.every((p) => p.ready));
    send(host, { type: "start" });
    await snapshotUntil(host, (s) => s.phase !== "LOBBY");

    expect((await reserve(port, { accountIds: ["a"] })).status).toBe(409);
  });
});

describe("a Reservation at connect (ADR 0112)", () => {
  it("takes its seat even when the connections and the Reservations fill the server — a stranger does not", async () => {
    const { port } = await start({ maxPlayers: 2 });
    await join(port);
    const { a } = await reserveTokens(port, ["a"]);

    expect((await nextClose(connect(port))).code).toBe(4003);
    await join(port, a);
    expect(await playerCount(port)).toBe(2);

    // Used up: the same token again is an ordinary connection, on a full server.
    expect((await nextClose(connect(port, a))).code).toBe(4003);
  });

  it("treats an unknown token as an ordinary connection", async () => {
    const { port } = await start();

    await join(port, "no-such-reservation");
    expect(await playerCount(port)).toBe(1);
  });

  it("frees its seat when nobody uses it in time, and its token is then an ordinary connection", async () => {
    const { port } = await start({ maxPlayers: 2, reservationTtlMs: 200 });
    await join(port);
    const { a } = await reserveTokens(port, ["a"]);
    expect((await nextClose(connect(port))).code).toBe(4003);

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await playerCount(port)).toBe(1);
    await join(port);
    expect((await nextClose(connect(port, a))).code).toBe(4003);
  });
});

// Review finding, 2026-09-19: the API pushes `follow` to every member before
// the caller's own HTTP answer is sent, so a member's socket can reach this
// server first — and the Lobby's host is its earliest joiner. A Party host
// could therefore end up a guest in its own member's Lobby, with the Track,
// the Round type and Start all somebody else's.
describe("a Party keeps its own host whichever socket arrives first (ADR 0112)", () => {
  it("hosts the Account the seats were reserved for first, though its member connects first", async () => {
    const { port } = await start();
    // The broker sends the caller first (`LobbiesService.plan`) — Amy pressed
    // the button, Bo is following her.
    const tokens = await reserveTokens(port, ["amy", "bo"]);

    const bo = await joinAs(port, tokens.bo);
    const amy = await joinAs(port, tokens.amy);

    const seated = await snapshotUntil(amy.socket, (s) => s.lobby.players.length === 2);
    expect(seated.lobby.hostId).toBe(amy.playerId);
    expect(seated.lobby.hostId).not.toBe(bo.playerId);
  });

  it("leaves an ordinary connection first come, first host", async () => {
    const { port } = await start();

    const first = await joinAs(port);
    const second = await joinAs(port);

    const seated = await snapshotUntil(first.socket, (s) => s.lobby.players.length === 2);
    expect(seated.lobby.hostId).toBe(first.playerId);
    expect(seated.lobby.hostId).not.toBe(second.playerId);
  });

  it("leaves a lapsed Reservation's places unused rather than handing them to the next arrival", async () => {
    const { port } = await start({ reservationTtlMs: 200 });
    // A Party of two that never arrives: both places are claimed and then lost.
    await reserveTokens(port, ["amy", "bo"]);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const first = await joinAs(port);
    await join(port);

    const seated = await snapshotUntil(first.socket, (s) => s.lobby.players.length === 2);
    expect(seated.lobby.hostId).toBe(first.playerId);
    expect(seated.lobby.players.map((p) => p.joinOrder)).toEqual([2, 3]);
  });
});

describe("the Lobby's start waits for the beans still arriving (ADR 0112)", () => {
  it("refuses the host's start with the reason on the snapshot, and starts once the bean has arrived", async () => {
    const { port } = await start();
    const host = await join(port);
    send(host, { type: "setReady", ready: true });
    await snapshotUntil(host, (s) => s.lobby.players.every((p) => p.ready));

    // Armed before the grant: an idle Lobby pushes its change once (ADR 0057).
    const blockedSeen = snapshotUntil(host, (s) => s.lobby.startBlockedReason !== undefined);
    const { a } = await reserveTokens(port, ["a"]);
    expect((await blockedSeen).lobby.startBlockedReason).toBe("Waiting for 1 bean to arrive.");
    send(host, { type: "start" });
    // A `sync` behind it on the same socket answers on a Tick after the start
    // was handled — LOADING already, had it been taken.
    const afterStart = snapshotUntil(host, () => true);
    send(host, { type: "sync" });
    expect((await afterStart).phase).toBe("LOBBY");

    const arrivedSeen = snapshotUntil(host, (s) => s.lobby.players.length === 2);
    const guest = await join(port, a);
    expect((await arrivedSeen).lobby.startBlockedReason).toBeUndefined();

    send(guest, { type: "setReady", ready: true });
    await snapshotUntil(host, (s) => s.lobby.players.length === 2 && s.lobby.players.every((p) => p.ready));
    send(host, { type: "start" });
    await snapshotUntil(host, (s) => s.phase === "LOADING");
  });

  it("starts once a Reservation nobody used has lapsed, the freed Start pushed to an idle Lobby", async () => {
    const { port } = await start({ reservationTtlMs: 400 });
    const host = await join(port);
    send(host, { type: "setReady", ready: true });
    await snapshotUntil(host, (s) => s.lobby.players.every((p) => p.ready));

    const blockedSeen = snapshotUntil(host, (s) => s.lobby.startBlockedReason !== undefined);
    await reserveTokens(port, ["a"]);
    await blockedSeen;
    send(host, { type: "start" });

    const freed = await snapshotUntil(host, (s) => s.lobby.startBlockedReason === undefined);
    // Had the start been taken, the Lobby would have been LOADING long before the Reservation lapsed.
    expect(freed.phase).toBe("LOBBY");
    expect(await playerCount(port)).toBe(1);

    send(host, { type: "start" });
    await snapshotUntil(host, (s) => s.phase === "LOADING");
  });
});
