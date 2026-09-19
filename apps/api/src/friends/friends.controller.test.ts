import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword, createSession } from "../auth/accounts.dao.js";
import { saveMatchResult } from "../matches/matches.service.js";
import type { LobbyStatus } from "../lobbies/lobbies.service.js";

/** Same fake match-server seam as the broker's own suite — no sockets, scripted statuses. */
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

const makeAccount = (name: string): { id: string; token: string } => {
  const account = createAccountWithPassword(
    db,
    { email: `${name}@example.com`, password: "password-123", displayName: name },
  );
  return { id: account.id, token: createSession(db, account.id).token };
};

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-friends-controller-test-"));
  db = openDb(join(dir, "test.sqlite"));
  fakes = fakeMatchServers();
  app = await buildApp({
    db,
    apiUrl: "http://localhost:8081",
    maxPlayers: 4,
    lobbies: { startMatchServer: fakes.startMatchServer, fetchLobbyStatus: fakes.fetchLobbyStatus },
  });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("friends routes (M9 ticket 12)", () => {
  it("every route 401s without a Bearer [REDACTED]", async () => {
    const calls = [
      app.inject({ method: "GET", url: "/friends" }),
      app.inject({ method: "GET", url: "/friends/code" }),
      app.inject({ method: "GET", url: "/friends/requests" }),
      app.inject({ method: "GET", url: "/friends/recent" }),
      app.inject({ method: "POST", url: "/friends/heartbeat" }),
      app.inject({ method: "POST", url: "/friends/requests", payload: {} }),
      app.inject({ method: "POST", url: "/friends/requests/accept-all" }),
      app.inject({ method: "POST", url: "/friends/requests/x/accept" }),
      app.inject({ method: "POST", url: "/friends/requests/x/decline" }),
      app.inject({ method: "POST", url: "/friends/invite", payload: {} }),
      app.inject({ method: "DELETE", url: "/friends/x" }),
    ];
    for (const res of await Promise.all(calls)) expect(res.statusCode).toBe(401);
  });

  it("request → accept over HTTP ends with both rosters showing the friendship", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");

    const code = (await app.inject({ method: "GET", url: "/friends/code", headers: auth(bo.token) })).json().code;
    const sent = await app.inject({
      method: "POST",
      url: "/friends/requests",
      headers: auth(amy.token),
      payload: { code },
    });
    expect(sent.statusCode).toBe(201);

    const inbox = (await app.inject({ method: "GET", url: "/friends/requests", headers: auth(bo.token) })).json();
    expect(inbox.requests).toEqual([
      expect.objectContaining({ fromAccountId: amy.id, fromDisplayName: "Amy", matchesTogether: 0 }),
    ]);

    const accepted = await app.inject({
      method: "POST",
      url: `/friends/requests/${inbox.requests[0].id}/accept`,
      headers: auth(bo.token),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().friend.displayName).toBe("Amy");

    for (const viewer of [amy, bo]) {
      const overview = (await app.inject({ method: "GET", url: "/friends", headers: auth(viewer.token) })).json();
      expect(overview.total).toBe(1);
      expect(overview.requests).toEqual([]);
    }
  });

  it("a friend seated in a broker Lobby reads in-lobby with the Lobby's own ref", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");

    const code = (await app.inject({ method: "GET", url: "/friends/code", headers: auth(bo.token) })).json().code;
    await app.inject({ method: "POST", url: "/friends/requests", headers: auth(amy.token), payload: { code } });
    const inbox = (await app.inject({ method: "GET", url: "/friends/requests", headers: auth(bo.token) })).json();
    await app.inject({ method: "POST", url: `/friends/requests/${inbox.requests[0].id}/accept`, headers: auth(bo.token) });

    const created = (
      await app.inject({ method: "POST", url: "/lobbies", payload: { isPrivate: true } })
    ).json() as { code: string };
    const port = [...fakes.statuses.keys()][0]!;
    fakes.statuses.set(port, { playerCount: 1, maxPlayers: 4, phase: "LOBBY", accounts: [bo.id], round: null });

    const overview = (await app.inject({ method: "GET", url: "/friends", headers: auth(amy.token) })).json();
    expect(overview.online).toBe(1);
    expect(overview.friends[0].presence).toEqual({
      status: "in-lobby",
      slotsOpen: 3,
      joinable: true,
      lobby: { kind: "private", code: created.code },
    });

    fakes.statuses.set(port, { playerCount: 2, maxPlayers: 4, phase: "RUNNING", accounts: [bo.id], round: 2 });
    const racing = (await app.inject({ method: "GET", url: "/friends", headers: auth(amy.token) })).json();
    expect(racing.friends[0].presence).toEqual({ status: "in-match", round: 2 });

    fakes.statuses.set(port, { playerCount: 4, maxPlayers: 4, phase: "LOBBY", accounts: [bo.id], round: null });
    const full = (await app.inject({ method: "GET", url: "/friends", headers: auth(amy.token) })).json();
    expect(full.friends[0].presence).toEqual({
      status: "in-lobby",
      slotsOpen: 0,
      lobby: { kind: "private", code: created.code },
      joinable: false,
    });
  });

  it("heartbeat surfaces a sent invite exactly once; strangers cannot invite", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const cy = makeAccount("Cy");

    const code = (await app.inject({ method: "GET", url: "/friends/code", headers: auth(bo.token) })).json().code;
    await app.inject({ method: "POST", url: "/friends/requests", headers: auth(amy.token), payload: { code } });
    const inbox = (await app.inject({ method: "GET", url: "/friends/requests", headers: auth(bo.token) })).json();
    await app.inject({ method: "POST", url: `/friends/requests/${inbox.requests[0].id}/accept`, headers: auth(bo.token) });

    const refused = await app.inject({
      method: "POST",
      url: "/friends/invite",
      headers: auth(cy.token),
      payload: { accountId: bo.id, lobby: { kind: "public", lobbyId: "lobby-1" } },
    });
    expect(refused.statusCode).toBe(403);

    const invited = await app.inject({
      method: "POST",
      url: "/friends/invite",
      headers: auth(amy.token),
      payload: { accountId: bo.id, lobby: { kind: "public", lobbyId: "lobby-1" } },
    });
    expect(invited.statusCode).toBe(201);

    const first = (await app.inject({ method: "POST", url: "/friends/heartbeat", headers: auth(bo.token) })).json();
    expect(first.invites).toEqual([
      expect.objectContaining({ fromDisplayName: "Amy", lobby: { kind: "public", lobbyId: "lobby-1" } }),
    ]);
    const second = (await app.inject({ method: "POST", url: "/friends/heartbeat", headers: auth(bo.token) })).json();
    expect(second.invites).toEqual([]);
  });

  it("decline, accept-all, and unfriend round-trip over HTTP", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const cy = makeAccount("Cy");

    const codeOf = async (token: string): Promise<string> =>
      (await app.inject({ method: "GET", url: "/friends/code", headers: auth(token) })).json().code;
    await app.inject({ method: "POST", url: "/friends/requests", headers: auth(amy.token), payload: { code: await codeOf(cy.token) } });
    await app.inject({ method: "POST", url: "/friends/requests", headers: auth(bo.token), payload: { code: await codeOf(cy.token) } });

    const inbox = (await app.inject({ method: "GET", url: "/friends/requests", headers: auth(cy.token) })).json();
    const declined = await app.inject({
      method: "POST",
      url: `/friends/requests/${inbox.requests[0].id}/decline`,
      headers: auth(cy.token),
    });
    expect(declined.statusCode).toBe(200);

    const acceptedAll = await app.inject({
      method: "POST",
      url: "/friends/requests/accept-all",
      headers: auth(cy.token),
    });
    expect(acceptedAll.json()).toEqual({ accepted: 1 });

    const removed = await app.inject({ method: "DELETE", url: `/friends/${bo.id}`, headers: auth(cy.token) });
    expect(removed.json()).toEqual({ removed: true });
    const removedAgain = await app.inject({ method: "DELETE", url: `/friends/${bo.id}`, headers: auth(cy.token) });
    expect(removedAgain.json()).toEqual({ removed: false });
  });

  it("request validation answers 400/404/409, never a silent no-op", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");

    const empty = await app.inject({ method: "POST", url: "/friends/requests", headers: auth(amy.token), payload: {} });
    expect(empty.statusCode).toBe(400);
    const badCode = await app.inject({
      method: "POST",
      url: "/friends/requests",
      headers: auth(amy.token),
      payload: { code: "ZZZZZZ" },
    });
    expect(badCode.statusCode).toBe(404);
    const self = await app.inject({
      method: "POST",
      url: "/friends/requests",
      headers: auth(amy.token),
      payload: { accountId: amy.id },
    });
    expect(self.statusCode).toBe(400);

    const code = (await app.inject({ method: "GET", url: "/friends/code", headers: auth(bo.token) })).json().code;
    await app.inject({ method: "POST", url: "/friends/requests", headers: auth(amy.token), payload: { code } });
    const duplicate = await app.inject({
      method: "POST",
      url: "/friends/requests",
      headers: auth(amy.token),
      payload: { code },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("recent lists co-players from finished Matches", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");

    saveMatchResult(db, {
      matchId: "m1",
      results: [{ rows: [{ id: "p1", placement: 1, qualified: true }] }],
      nicknames: { p1: "X" },
      accountIds: { p1: amy.id, p2: bo.id },
      totalFalls: {},
      endedAtMs: 1_000,
    });

    const recent = (await app.inject({ method: "GET", url: "/friends/recent", headers: auth(amy.token) })).json();
    expect(recent).toEqual({
      recent: [
        { accountId: bo.id, displayName: "Bo", avatarUrl: null, color: 0, matchesTogether: 1, lastPlayedAt: 1_000 },
      ],
    });
  });
});
