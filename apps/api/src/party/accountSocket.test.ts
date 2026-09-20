import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  ACCOUNT_SOCKET_PATH,
  ACCOUNT_SOCKET_REPLACED,
  ACCOUNT_SOCKET_UNAUTHORIZED,
  type AccountServerMessage,
} from "@dont-fall/shared";
import { startApi, type ApiService } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword, createSession, deleteSession } from "../auth/accounts.dao.js";
import { beatsFor } from "../friends/friends.dao.js";

/**
 * The Account socket over real sockets (ADR 0112): a real API listening on
 * localhost, real `ws` clients, the real database the beats land in.
 */
const BEAT_MS = 40;

let dir: string;
let db: ApiDb;
let api: ApiService;
const clients: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-account-socket-"));
  db = openDb(join(dir, "test.sqlite"));
  api = await startApi({
    port: 0,
    host: "127.0.0.1",
    db,
    maxPlayers: 4,
    lobbies: {
      startMatchServer: async () => ({ port: 1, close: async () => {} }),
      fetchLobbyStatus: async () => null,
    },
    parties: { accountBeatMs: BEAT_MS },
  });
});

afterEach(async () => {
  // Closed with sockets still open: they must not hold the API's shutdown up.
  await api.close();
  for (const client of clients.splice(0)) client.terminate();
  rmSync(dir, { recursive: true, force: true });
});

const makeAccount = (name: string): { id: string; token: string } => {
  const account = createAccountWithPassword(db, { email: `${name}@example.com`, password: "password-123", displayName: name });
  return { id: account.id, token: createSession(db, account.id).token };
};

const auth = (who: { token: string }): Record<string, string> => ({
  authorization: `Bearer ${who.token}`,
  "content-type": "application/json",
});

/** A client on the Account socket: every message it got, and how it closed. */
const connect = (firstMessage?: string, options: { autoPong?: boolean } = {}) => {
  const socket = new WebSocket(`ws://127.0.0.1:${api.port}${ACCOUNT_SOCKET_PATH}`, options);
  clients.push(socket);
  const received: AccountServerMessage[] = [];
  let closeCode: number | null = null;
  socket.on("message", (data) => received.push(JSON.parse(String(data)) as AccountServerMessage));
  socket.on("close", (code) => (closeCode = code));
  if (firstMessage !== undefined) socket.on("open", () => socket.send(firstMessage));
  return {
    socket,
    received,
    closeCode: () => closeCode,
    /** Waits for a message of `type`, the latest one when several came. */
    next: async <T extends AccountServerMessage["type"]>(type: T): Promise<Extract<AccountServerMessage, { type: T }>> => {
      await vi.waitFor(() => expect(received.some((message) => message.type === type)).toBe(true), { timeout: 2_000 });
      return received.filter((message) => message.type === type).at(-1) as Extract<AccountServerMessage, { type: T }>;
    },
  };
};

const signIn = (who: { token: string }, options: { autoPong?: boolean } = {}) =>
  connect(JSON.stringify({ type: "auth", token: who.token }), options);

const befriend = async (a: { id: string; token: string }, b: { id: string; token: string }): Promise<void> => {
  const base = `http://127.0.0.1:${api.port}`;
  await fetch(`${base}/friends/requests`, { method: "POST", headers: auth(a), body: JSON.stringify({ accountId: b.id }) });
  const inbox = (await (await fetch(`${base}/friends/requests`, { headers: auth(b) })).json()) as { requests: { id: string }[] };
  await fetch(`${base}/friends/requests/${inbox.requests[0]!.id}/accept`, { method: "POST", headers: auth(b) });
};

const inviteToLobby = (from: { token: string }, to: { id: string }) =>
  fetch(`http://127.0.0.1:${api.port}/friends/invite`, {
    method: "POST",
    headers: auth(from),
    body: JSON.stringify({ accountId: to.id, lobby: { kind: "public", lobbyId: "lobby-1" } }),
  });

describe("the Account socket (ADR 0112)", () => {
  it("closes a socket whose first message is not a good sign-in", async () => {
    const wrongToken = connect(JSON.stringify({ type: "auth", token: "not-a-session" }));
    const noAuth = connect(JSON.stringify({ type: "place", place: "menu" }));
    const garbage = connect("{ not json");

    await vi.waitFor(() => {
      expect(wrongToken.closeCode()).toBe(ACCOUNT_SOCKET_UNAUTHORIZED);
      expect(noAuth.closeCode()).toBe(ACCOUNT_SOCKET_UNAUTHORIZED);
      expect(garbage.closeCode()).toBe(ACCOUNT_SOCKET_UNAUTHORIZED);
    });
    expect([...wrongToken.received, ...noAuth.received, ...garbage.received]).toEqual([]);
  });

  it("answers a sign-in with ready, then the Party, and writes the presence beat", async () => {
    const amy = makeAccount("Amy");
    const client = signIn(amy);

    const party = await client.next("party");
    expect(client.received[0]).toEqual({ type: "ready", accountId: amy.id });
    expect(party.party).toMatchObject({ hostAccountId: amy.id, members: [{ accountId: amy.id, online: true }], pending: [] });
    expect(party.party.code).toMatch(/^[A-Z2-9]{6}$/);

    const first = beatsFor(db, [amy.id]).get(amy.id);
    expect(first).toBeDefined();
    await vi.waitFor(() => expect(beatsFor(db, [amy.id]).get(amy.id)!).toBeGreaterThan(first!), { timeout: 2_000 });
  });

  it("pushes a Lobby invite the moment it is sent, and hands one sent while closed over on connect", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    await befriend(amy, bo);

    // Sent while Bo's game is closed: it waits for the connect, after the Party.
    expect((await inviteToLobby(amy, bo)).status).toBe(201);
    const late = signIn(bo);
    await late.next("lobbyInvite");
    expect(late.received.map((message) => message.type)).toEqual(["ready", "party", "lobbyInvite"]);

    const second = await inviteToLobby(amy, bo);
    await vi.waitFor(() => expect(late.received.filter((message) => message.type === "lobbyInvite")).toHaveLength(2));
    expect(await late.next("lobbyInvite")).toEqual({
      type: "lobbyInvite",
      invite: {
        id: ((await second.json()) as { id: string }).id,
        fromAccountId: amy.id,
        fromDisplayName: "Amy",
        fromColor: 0,
        lobby: { kind: "public", lobbyId: "lobby-1" },
        sentAt: expect.any(Number),
      },
    });

    // A send is only ever "a socket took the bytes", which a half-open one
    // the ping sweep has not caught does too — so every live invite is handed
    // over again on the next connect, and the client drops what it has by id.
    late.socket.close();
    const again = signIn(bo);
    await again.next("lobbyInvite");
    await vi.waitFor(() => expect(again.received.filter((message) => message.type === "lobbyInvite")).toHaveLength(2));
  });

  it("lets a newer socket take over, closing the older with a reason, without the Account going offline", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const older = signIn(amy);
    await older.next("party");
    const watcher = signIn(bo);
    await watcher.next("party");

    const newer = signIn(amy);
    await newer.next("party");
    await vi.waitFor(() => expect(older.closeCode()).toBe(ACCOUNT_SOCKET_REPLACED));

    // Still online: Bo can invite Amy, and the invite reaches the newer socket only.
    const res = await fetch(`http://127.0.0.1:${api.port}/party/invites`, {
      method: "POST",
      headers: auth(bo),
      body: JSON.stringify({ code: await friendCodeOf(amy) }),
    });
    expect(res.status).toBe(201);
    await newer.next("partyInvite");
    expect(older.received.some((message) => message.type === "partyInvite")).toBe(false);
  });

  it("ignores a place frame from a socket a newer tab took over from", async () => {
    const amy = makeAccount("Amy");
    const older = signIn(amy);
    await older.next("party");
    older.socket.send(JSON.stringify({ type: "place", place: "match" }));
    await vi.waitFor(async () => expect((await older.next("party")).party.members[0]?.place).toBe("match"));

    // The older tab stops reading before it is replaced, so it never learns
    // it was: it keeps writing, which is the frame-in-flight this guards
    // against. A send on a socket the API has closed also reports an error,
    // never the suite's to crash on.
    older.socket.on("error", () => {});
    (older.socket as unknown as { _socket: { pause: () => void } })._socket.pause();

    const newer = signIn(amy);
    await newer.next("party");
    newer.socket.send(JSON.stringify({ type: "place", place: "menu" }));
    await vi.waitFor(async () => expect((await newer.next("party")).party.members[0]?.place).toBe("menu"));

    // Where the old tab still thinks it is must not move the Account.
    older.socket.send(JSON.stringify({ type: "place", place: "lobby", lobbyPort: 51001 }));
    newer.socket.send(JSON.stringify({ type: "place", place: "match" }));

    await vi.waitFor(async () => expect((await newer.next("party")).party.members[0]?.place).toBe("match"));
    const places = newer.received.flatMap((message) => (message.type === "party" ? [message.party.members[0]?.place] : []));
    expect(places).not.toContain("lobby");
  });

  it("closes a socket whose session has gone — at sign-out, and on the next beat when the row goes behind its back", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const cy = makeAccount("Cy");
    const codes = [await friendCodeOf(amy), await friendCodeOf(bo)];
    const amyClient = signIn(amy);
    const boClient = signIn(bo);
    const cyClient = signIn(cy);
    for (const client of [amyClient, boClient, cyClient]) await client.next("party");

    const out = await fetch(`http://127.0.0.1:${api.port}/auth/logout`, { method: "POST", headers: auth(amy) });
    expect(out.status).toBe(204);
    // Bo's session row goes behind its socket's back (a sign-out elsewhere, an
    // expiry): only the beat sweep's re-check can notice that one.
    deleteSession(db, bo.token);

    await vi.waitFor(
      () => {
        expect(amyClient.closeCode()).toBe(ACCOUNT_SOCKET_UNAUTHORIZED);
        expect(boClient.closeCode()).toBe(ACCOUNT_SOCKET_UNAUTHORIZED);
      },
      { timeout: 2_000 },
    );

    // Offline with their sessions: neither is still in a Party to be invited into one.
    for (const code of codes) {
      const res = await fetch(`http://127.0.0.1:${api.port}/party/invites`, {
        method: "POST",
        headers: auth(cy),
        body: JSON.stringify({ code }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/is offline$/);
    }
  });

  it("closes a socket that stops answering pings, so a dead connection does not read online", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const watcher = signIn(amy);
    const silent = signIn(bo, { autoPong: false });
    await silent.next("party");
    const code = await friendCodeOf(bo);

    await vi.waitFor(() => expect(silent.closeCode()).not.toBeNull(), { timeout: 2_000 });
    await watcher.next("party");
    const res = await fetch(`http://127.0.0.1:${api.port}/party/invites`, {
      method: "POST",
      headers: auth(amy),
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("Bo is offline");
  });

  it("takes where the client says it is, and shrugs off frames it cannot read", async () => {
    const amy = makeAccount("Amy");
    const client = signIn(amy);
    await client.next("party");

    client.socket.send("{ not json");
    client.socket.send(Buffer.from([1, 2, 3]), { binary: true });
    client.socket.send(JSON.stringify({ type: "place", place: "the moon" }));
    client.socket.send(JSON.stringify({ type: "place", place: "match" }));

    await vi.waitFor(() => expect(client.received.at(-1)).toMatchObject({ type: "party", party: { members: [{ place: "match" }] } }));
    expect(client.closeCode()).toBeNull();
  });
});

const friendCodeOf = async (who: { token: string }): Promise<string> =>
  ((await (await fetch(`http://127.0.0.1:${api.port}/friends/code`, { headers: auth(who) })).json()) as { code: string }).code;
