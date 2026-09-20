import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PartyCandidatesView, PartyView } from "@dont-fall/shared";
import { buildApp } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword, createSession } from "../auth/accounts.dao.js";
import { ensureFriendCode, recordBeat } from "../friends/friends.dao.js";
import { saveMatchResult } from "../matches/matches.service.js";
import type { LobbyStatus } from "../lobbies/lobbies.service.js";
import type { PartiesService } from "./parties.service.js";

/**
 * The `/party` routes through the real `buildApp` wiring (ADR 0112). No
 * Account socket opens here — the suite takes the service's handle and
 * brings Accounts online itself; `accountSocket.test.ts` proves the socket.
 */
const fakeMatchServers = () => {
  let nextPort = 63000;
  const statuses = new Map<number, LobbyStatus>();
  return {
    statuses,
    startMatchServer: vi.fn(async () => {
      const port = nextPort++;
      statuses.set(port, { playerCount: 0, maxPlayers: 4, phase: "LOBBY", accounts: [], round: null });
      return { port, close: async () => void statuses.delete(port) };
    }),
    fetchLobbyStatus: vi.fn(async (port: number) => statuses.get(port) ?? null),
    reserveSeats: vi.fn(async (port: number, accountIds: readonly string[]) =>
      Object.fromEntries(accountIds.map((id) => [id, `${port}-${id}`])),
    ),
  };
};

let dir: string;
let db: ApiDb;
let app: FastifyInstance;
let parties: PartiesService;
let fakes: ReturnType<typeof fakeMatchServers>;

const makeAccount = (name: string): { id: string; token: string } => {
  const account = createAccountWithPassword(db, { email: `${name}@example.com`, password: "password-123", displayName: name });
  return { id: account.id, token: createSession(db, account.id).token };
};

const auth = (who: { token: string }): { authorization: string } => ({ authorization: `Bearer ${who.token}` });

const befriend = async (a: { id: string; token: string }, b: { id: string; token: string }): Promise<void> => {
  await app.inject({ method: "POST", url: "/friends/requests", headers: auth(a), payload: { accountId: b.id } });
  const inbox = (await app.inject({ method: "GET", url: "/friends/requests", headers: auth(b) })).json();
  await app.inject({ method: "POST", url: `/friends/requests/${inbox.requests[0].id}/accept`, headers: auth(b) });
};

const invite = (host: { token: string }, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/party/invites", headers: auth(host), payload });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-party-controller-test-"));
  db = openDb(join(dir, "test.sqlite"));
  fakes = fakeMatchServers();
  app = await buildApp({
    db,
    apiUrl: "http://localhost:8081",
    maxPlayers: 4,
    lobbies: fakes,
    parties: { expose: (service) => (parties = service) },
  });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("party routes (ADR 0112)", () => {
  it("every route 401s without a session", async () => {
    const calls = [
      app.inject({ method: "GET", url: "/party/candidates" }),
      app.inject({ method: "GET", url: "/party/lookup/ABCDEF" }),
      app.inject({ method: "POST", url: "/party/invites", payload: {} }),
      app.inject({ method: "DELETE", url: "/party/invites/x" }),
      app.inject({ method: "POST", url: "/party/invites/x/accept" }),
      app.inject({ method: "POST", url: "/party/invites/x/decline" }),
      app.inject({ method: "POST", url: "/party/join", payload: {} }),
      app.inject({ method: "POST", url: "/party/leave" }),
      app.inject({ method: "DELETE", url: "/party/members/x" }),
    ];
    for (const res of await Promise.all(calls)) expect(res.statusCode).toBe(401);
  });

  it("lists friends and recent players once each, with the state the invite card shows", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const cy = makeAccount("Cy");
    const di = makeAccount("Di");
    const ed = makeAccount("Ed");
    for (const friend of [bo, cy, di]) await befriend(amy, friend);
    saveMatchResult(db, {
      matchId: "m1",
      results: [{ rows: [{ id: "p1", placement: 1, qualified: true }] }],
      nicknames: { p1: "X" },
      accountIds: { p1: amy.id, p2: bo.id, p3: ed.id },
      totalFalls: {},
      endedAtMs: 5_000,
    });
    recordBeat(db, ed.id, 4_000);
    for (const who of [amy, bo, cy, di]) parties.connected(who.id);
    // Di is in a Party of two with Cy; Bo is still on a podium.
    await parties.acceptInvite(di.id, parties.invite(cy.id, di.id, { gated: false }).inviteId);
    parties.setPlace(bo.id, "match");
    parties.setPlace(di.id, "lobby", 63999);

    const body = (await app.inject({ method: "GET", url: "/party/candidates", headers: auth(amy) })).json() as PartyCandidatesView;

    expect(body.friendCount).toBe(3);
    const byName = new Map(body.candidates.map((candidate) => [candidate.displayName, candidate]));
    expect([...byName.keys()].sort()).toEqual(["Bo", "Cy", "Di", "Ed"]);
    // Friends first, then the recent players who are not.
    expect(body.candidates.at(-1)?.displayName).toBe("Ed");
    expect(byName.get("Bo")).toMatchObject({ state: "free", friend: true, online: true, inMatch: true, place: "match", lastPlayedAt: 5_000 });
    expect(byName.get("Cy")).toMatchObject({ state: "busy", otherPartySize: 2, online: true, inMatch: false, place: "menu", lastPlayedAt: null });
    expect(byName.get("Di")).toMatchObject({ online: true, inMatch: false, place: "lobby" });
    expect(byName.get("Ed")).toMatchObject({ state: "busy", friend: false, online: false, place: null, lastSeenAt: 4_000, lastPlayedAt: 5_000 });

    const { inviteId } = (await invite(amy, { accountId: bo.id })).json() as { inviteId: string };
    const after = (await app.inject({ method: "GET", url: "/party/candidates", headers: auth(amy) })).json() as PartyCandidatesView;
    expect(after.candidates.find((candidate) => candidate.accountId === bo.id)).toMatchObject({
      state: "invited",
      inviteId,
      inviteSentAt: expect.any(Number),
    });
  });

  it("says where a bean is only while its Account socket is open — a closed one in its grace is not IN MENU", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    await befriend(amy, bo);
    for (const who of [amy, bo]) parties.connected(who.id);
    const boRow = async () =>
      ((await app.inject({ method: "GET", url: "/party/candidates", headers: auth(amy) })).json() as PartyCandidatesView).candidates.find(
        (candidate) => candidate.accountId === bo.id,
      );

    expect(await boRow()).toMatchObject({ online: true, place: "menu" });
    parties.disconnected(bo.id);
    // Bo is still in a Party through its grace, and its last place is kept — but nobody is in the menus from a closed tab.
    expect(parties.placeOf(bo.id)).toBe("menu");
    expect(await boRow()).toMatchObject({ online: false, place: null });
  });

  it("invites friends and recent players by id, anyone by friend code, and accepting answers the Party", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const stranger = makeAccount("Stranger");
    await befriend(amy, bo);
    for (const who of [amy, bo, stranger]) parties.connected(who.id);

    expect((await invite(amy, { accountId: stranger.id })).statusCode).toBe(403);
    expect((await invite(amy, { accountId: "nobody" })).statusCode).toBe(404);
    expect((await invite(amy, {})).statusCode).toBe(400);
    const byCode = await invite(amy, { code: ensureFriendCode(db, stranger.id) });
    expect(byCode.statusCode).toBe(201);

    const sent = await invite(amy, { accountId: bo.id });
    expect(sent.statusCode).toBe(201);
    const { inviteId } = sent.json() as { inviteId: string };
    expect((await invite(amy, { accountId: bo.id })).statusCode).toBe(409);

    const accepted = await app.inject({ method: "POST", url: `/party/invites/${inviteId}/accept`, headers: auth(bo) });
    expect(accepted.statusCode).toBe(200);
    const party = accepted.json() as PartyView;
    expect(party.hostAccountId).toBe(amy.id);
    expect(party.members.map((member) => member.displayName)).toEqual(["Amy", "Bo"]);
    expect(party.code).toBeNull();

    const strangerInvite = (byCode.json() as { inviteId: string }).inviteId;
    expect((await app.inject({ method: "POST", url: `/party/invites/${strangerInvite}/decline`, headers: auth(bo) })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/party/invites/${strangerInvite}`, headers: auth(bo) })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/party/invites/${strangerInvite}`, headers: auth(amy) })).statusCode).toBe(204);
  });

  it("looks a pasted code up as a Party code first, then a friend code", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    parties.connected(amy.id);
    parties.connected(bo.id);
    const partyCode = parties.view(amy.id)!.code!;

    const asParty = await app.inject({ method: "GET", url: `/party/lookup/${partyCode}`, headers: auth(bo) });
    expect(asParty.json()).toEqual({
      kind: "party",
      partyId: parties.partyOf(amy.id),
      hostAccountId: amy.id,
      hostDisplayName: "Amy",
      hostColor: 0,
      hostAvatarUploadedAt: null,
      size: 1,
    });

    const asBean = await app.inject({ method: "GET", url: `/party/lookup/${ensureFriendCode(db, bo.id)}`, headers: auth(amy) });
    expect(asBean.json()).toEqual({ kind: "account", accountId: bo.id, displayName: "Bo", color: 0, avatarUploadedAt: null, state: "free" });

    expect((await app.inject({ method: "GET", url: "/party/lookup/ZZZZZZ", headers: auth(amy) })).statusCode).toBe(404);
  });

  it("joins by Party code, leaves, and lets only the host remove", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    const cy = makeAccount("Cy");
    for (const who of [amy, bo, cy]) parties.connected(who.id);
    const code = parties.view(amy.id)!.code!;

    const joined = await app.inject({ method: "POST", url: "/party/join", headers: auth(bo), payload: { code } });
    expect(joined.statusCode).toBe(200);
    expect((joined.json() as PartyView).members.map((member) => member.displayName)).toEqual(["Amy", "Bo"]);
    expect((await app.inject({ method: "POST", url: "/party/join", headers: auth(bo), payload: { code } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/party/join", headers: auth(cy), payload: {} })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/party/join", headers: auth(cy), payload: { code } });

    expect((await app.inject({ method: "DELETE", url: `/party/members/${cy.id}`, headers: auth(bo) })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/party/members/${cy.id}`, headers: auth(amy) })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: "/party/leave", headers: auth(bo) })).statusCode).toBe(204);
    expect(parties.view(amy.id)?.members.map((member) => member.displayName)).toEqual(["Amy"]);
  });

  it("seats the caller's Party through the Lobby routes, reading the session they send", async () => {
    const amy = makeAccount("Amy");
    const bo = makeAccount("Bo");
    for (const who of [amy, bo]) parties.connected(who.id);
    await app.inject({ method: "POST", url: "/party/join", headers: auth(bo), payload: { code: parties.view(amy.id)!.code } });

    const created = await app.inject({ method: "POST", url: "/lobbies", headers: auth(amy), payload: { isPrivate: true } });
    expect(created.statusCode).toBe(201);
    const lobby = created.json() as { id: string; port: number; code: string; reservation: string };
    expect(lobby.reservation).toBe(`${lobby.port}-${amy.id}`);
    expect(fakes.reserveSeats).toHaveBeenCalledWith(lobby.port, [amy.id, bo.id], expect.any(String));

    // A member entering elsewhere on its own leaves the Party, and is told whose.
    const alone = await app.inject({ method: "POST", url: "/lobbies/quick-match", headers: auth(bo) });
    expect(alone.json()).toMatchObject({ reservation: expect.any(String), leftPartyOf: "Amy" });

    // A waiting host is told who it waits for.
    await app.inject({ method: "POST", url: "/party/join", headers: auth(bo), payload: { code: parties.view(amy.id)!.code } });
    parties.setPlace(bo.id, "lobby");
    const waiting = await app.inject({ method: "POST", url: "/lobbies/join", headers: auth(amy), payload: { code: lobby.code } });
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json()).toEqual({ error: "waiting for Bo" });
  });
});
