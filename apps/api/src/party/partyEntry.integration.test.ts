import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  ACCOUNT_SOCKET_PATH,
  matchSocketPath,
  type AccountClientMessage,
  type AccountServerMessage,
  type LobbyEntryGrant,
  type ServerMessage,
} from "@dont-fall/shared";
import { startApi, type ApiService } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword, createSession } from "../auth/accounts.dao.js";

/**
 * A Party walking into a Lobby over the real wire (ADR 0112), end to end:
 * each slice's own suite fakes the side it talks to, so this is the one place
 * the broker's `reserveSeats`, a real Match server's `POST /reservations`
 * (and the secret the API handed it), the Account socket's `follow` and
 * `place`, and the `?reservation=` carried through the API's Lobby-socket
 * proxy are all real at once.
 *
 * The Match servers the API under test starts fetch their boot Track from a
 * second API (ADR 0028) — the one under test cannot name its own port before
 * it listens.
 */
let dir: string;
let db: ApiDb;
let tracks: ApiService;
let api: ApiService;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-party-entry-"));
  tracks = await startApi({ port: 0, dbPath: ":memory:" });
  db = openDb(join(dir, "test.sqlite"));
  api = await startApi({ port: 0, db, maxPlayers: 4, apiUrl: `http://localhost:${tracks.port}` });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await api.close();
  await tracks.close();
  rmSync(dir, { recursive: true, force: true });
});

const makeAccount = (name: string): { id: string; token: string } => {
  const account = createAccountWithPassword(db, { email: `${name}@example.com`, password: "password-123", displayName: name });
  return { id: account.id, token: createSession(db, account.id).token };
};

const call = (who: { token: string }, method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`http://127.0.0.1:${api.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${who.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Signed in on the Account socket, as the client's `accountSocket.ts` is. */
const accountSocket = (who: { token: string }) => {
  const socket = new WebSocket(`ws://127.0.0.1:${api.port}${ACCOUNT_SOCKET_PATH}`);
  sockets.push(socket);
  const received: AccountServerMessage[] = [];
  socket.on("message", (data) => received.push(JSON.parse(String(data)) as AccountServerMessage));
  socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token: who.token } satisfies AccountClientMessage)));
  return {
    say: (message: AccountClientMessage) => socket.send(JSON.stringify(message)),
    next: async <T extends AccountServerMessage["type"]>(type: T): Promise<Extract<AccountServerMessage, { type: T }>> => {
      await vi.waitFor(() => expect(received.some((message) => message.type === type)).toBe(true), { timeout: 5_000 });
      return received.filter((message) => message.type === type).at(-1) as Extract<AccountServerMessage, { type: T }>;
    },
  };
};

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

/**
 * A Lobby socket dialled the way the online client dials it: through the
 * API's `/match/<port>`, the Reservation on the query (`resolveEndpoints`).
 */
const lobbySocket = async (port: number, reservation: string) => {
  const socket = new WebSocket(`ws://127.0.0.1:${api.port}${matchSocketPath(port)}?reservation=${encodeURIComponent(reservation)}`);
  sockets.push(socket);
  const received: ServerMessage[] = [];
  socket.on("message", (raw) => received.push(JSON.parse(String(raw)) as ServerMessage));
  await vi.waitFor(() => expect(received[0]?.type).toBe("welcome"), { timeout: 10_000 });
  return {
    snapshotWhere: async (predicate: (snapshot: Snapshot) => boolean): Promise<Snapshot> => {
      const matching = (): Snapshot | undefined =>
        received.filter((message): message is Snapshot => message.type === "snapshot" && predicate(message)).at(-1);
      await vi.waitFor(() => expect(matching()).toBeDefined(), { timeout: 5_000 });
      return matching()!;
    },
  };
};

const playerCount = async (port: number): Promise<number> =>
  ((await (await fetch(`http://localhost:${port}/status`)).json()) as { playerCount: number }).playerCount;

describe("a Party entering a Lobby, end to end (ADR 0112)", () => {
  it("reserves both seats, sends the member after its host, and seats both through the proxy", { timeout: 30_000 }, async () => {
    const hana = makeAccount("Hana");
    const milo = makeAccount("Milo");
    const hanaAccount = accountSocket(hana);
    const miloAccount = accountSocket(milo);
    await hanaAccount.next("party");
    await miloAccount.next("party");

    // Hana invites Milo by the friend code pasted into her card, and Milo accepts.
    const code = ((await (await call(milo, "GET", "/friends/code")).json()) as { code: string }).code;
    const invited = await call(hana, "POST", "/party/invites", { code });
    expect(invited.status).toBe(201);
    const { invite } = await miloAccount.next("partyInvite");
    expect((await call(milo, "POST", `/party/invites/${invite.id}/accept`)).status).toBe(200);

    // The host queues: one real `POST /reservations` for both, with this process's secret.
    const entry = await call(hana, "POST", "/lobbies/quick-match");
    expect(entry.status).toBe(200);
    const grant = (await entry.json()) as LobbyEntryGrant;
    expect(grant.reservation).toEqual(expect.any(String));
    const follow = await miloAccount.next("follow");
    expect(follow).toEqual({
      type: "follow",
      lobby: { id: grant.id, port: grant.port },
      reservation: expect.any(String),
      hostDisplayName: "Hana",
    });
    expect(follow.reservation).not.toBe(grant.reservation);
    // Both seats are taken before either bean arrives — a stranger cannot have them.
    expect(await playerCount(grant.port)).toBe(2);

    // The host arrives: the Lobby cannot start without the bean still on its way.
    const hanaLobby = await lobbySocket(grant.port, grant.reservation!);
    hanaAccount.say({ type: "place", place: "lobby", lobbyPort: grant.port });
    const waiting = await hanaLobby.snapshotWhere((snapshot) => snapshot.lobby.startBlockedReason !== undefined);
    expect(waiting.lobby.startBlockedReason).toBe("Waiting for 1 bean to arrive.");

    // The member follows with its own Reservation, and the start is free.
    await lobbySocket(follow.lobby.port, follow.reservation);
    miloAccount.say({ type: "place", place: "lobby", lobbyPort: follow.lobby.port });
    const seated = await hanaLobby.snapshotWhere((snapshot) => snapshot.lobby.players.length === 2);
    expect(seated.lobby.startBlockedReason).toBeUndefined();
    expect(await playerCount(grant.port)).toBe(2);

    // The host walks out before the Match: the Party leaves with it.
    hanaAccount.say({ type: "place", place: "menu" });
    expect(await miloAccount.next("left")).toEqual({ type: "left", hostDisplayName: "Hana" });
  });
});
