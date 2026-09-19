import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { createAccountWithPassword } from "../auth/accounts.dao.js";
import { saveMatchResult } from "../matches/matches.service.js";
import { recordBeat } from "./friends.dao.js";
import {
  acceptAllFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  friendRequests,
  friendsOverview,
  heartbeat,
  inviteFriend,
  ownFriendCode,
  recentPlayers,
  sendFriendRequest,
  unfriend,
  type FriendsEnv,
  type LiveLobbySeat,
} from "./friends.service.js";

let dir: string;
let db: ApiDb;

const makeAccount = (name: string): string =>
  createAccountWithPassword(db, { email: `${name}@example.com`, password: "password-123", displayName: name }).id;

const RESULT = (matchId: string, accountIds: Record<string, string>, endedAtMs: number) => ({
  matchId,
  results: [{ rows: [{ id: "p1", placement: 1, qualified: true }] }],
  nicknames: { p1: "X" },
  accountIds,
  totalFalls: {},
  endedAtMs,
});

const NOW = 1_000_000_000;

const envWithSeats = (seats: LiveLobbySeat[]): FriendsEnv => ({
  presence: { liveSeats: async () => seats },
  now: () => NOW,
});

const seat = (overrides: {
  accountIds: readonly string[];
  lobbyId?: string;
  isPrivate?: boolean;
  code?: string;
  phase?: string;
  round?: number | null;
  playerCount?: number;
  maxPlayers?: number;
}): LiveLobbySeat => ({
  lobbyId: overrides.lobbyId ?? "lobby-1",
  phase: overrides.phase ?? "LOBBY",
  round: overrides.round ?? null,
  playerCount: overrides.playerCount ?? 2,
  maxPlayers: overrides.maxPlayers ?? 8,
  ...(overrides.isPrivate
    ? { isPrivate: true as const, code: overrides.code ?? "CODE42" }
    : { isPrivate: false as const }),
  accountIds: overrides.accountIds,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "api-friends-service-test-"));
  db = openDb(join(dir, "test.sqlite"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const expectServiceError = async (fn: () => unknown, statusCode: number): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).statusCode).toBe(statusCode);
    return;
  }
  expect.unreachable(`expected a ServiceError with status ${statusCode}`);
};

describe("ownFriendCode", () => {
  it("returns a stable code per Account", () => {
    const a = makeAccount("Amy");
    expect(ownFriendCode(db, a).code).toBe(ownFriendCode(db, a).code);
  });
});

describe("sendFriendRequest", () => {
  it("sends by code (case-insensitive) and by account id", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");
    const env = envWithSeats([]);

    const byCode = sendFriendRequest(db, env, a, { code: ownFriendCode(db, b).code.toLowerCase() });
    expect(byCode.id).toBeTruthy();
    expect(friendRequests(db, b).requests.map((r) => r.fromAccountId)).toEqual([a]);

    const byId = sendFriendRequest(db, env, a, { accountId: c });
    expect(byId.id).toBeTruthy();
    expect(friendRequests(db, c).requests.map((r) => r.fromAccountId)).toEqual([a]);
  });

  it("refuses self-adds, unknowns, empties, duplicates, and existing friends", async () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const env = envWithSeats([]);

    await expectServiceError(() => sendFriendRequest(db, env, a, { accountId: a }), 400);
    await expectServiceError(() => sendFriendRequest(db, env, a, { code: ownFriendCode(db, a).code }), 400);
    await expectServiceError(() => sendFriendRequest(db, env, a, { accountId: "ghost" }), 404);
    await expectServiceError(() => sendFriendRequest(db, env, a, { code: "ZZZZZZ" }), 404);
    await expectServiceError(() => sendFriendRequest(db, env, a, {}), 400);

    sendFriendRequest(db, env, a, { accountId: b });
    await expectServiceError(() => sendFriendRequest(db, env, a, { accountId: b }), 409);
    await expectServiceError(() => sendFriendRequest(db, env, b, { accountId: a }), 409);

    acceptFriendRequest(db, env, b, friendRequests(db, b).requests[0]!.id);
    await expectServiceError(() => sendFriendRequest(db, env, a, { accountId: b }), 409);
  });
});

describe("friendRequests", () => {
  it("attaches matches played together to each incoming request", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");
    const env = envWithSeats([]);

    saveMatchResult(db, RESULT("m1", { p1: a, p2: b }, 1_000));
    saveMatchResult(db, RESULT("m2", { p1: a, p2: b }, 2_000));
    sendFriendRequest(db, env, b, { accountId: a });
    sendFriendRequest(db, env, c, { accountId: a });

    expect(friendRequests(db, a).requests).toEqual([
      expect.objectContaining({ fromAccountId: b, fromDisplayName: "Bo", matchesTogether: 2 }),
      expect.objectContaining({ fromAccountId: c, matchesTogether: 0 }),
    ]);
  });
});

describe("acceptFriendRequest / declineFriendRequest / acceptAllFriendRequests", () => {
  it("accept returns the new friend; phantom or foreign ids are 404", async () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");
    const env = envWithSeats([]);

    const { id } = sendFriendRequest(db, env, a, { accountId: b });
    await expectServiceError(() => acceptFriendRequest(db, env, c, id), 404);
    await expectServiceError(() => acceptFriendRequest(db, env, b, "phantom"), 404);

    expect(acceptFriendRequest(db, env, b, id)).toEqual({
      friend: { accountId: a, displayName: "Amy", avatarUrl: null },
    });
    expect(friendRequests(db, b).requests).toEqual([]);
  });

  it("decline clears one request; accept-all clears the inbox and counts", async () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");
    const env = envWithSeats([]);

    const first = sendFriendRequest(db, env, a, { accountId: c });
    sendFriendRequest(db, env, b, { accountId: c });
    await expectServiceError(() => declineFriendRequest(db, c, "phantom"), 404);

    expect(declineFriendRequest(db, c, first.id)).toEqual({ id: first.id });
    expect(acceptAllFriendRequests(db, env, c)).toEqual({ accepted: 1 });
    expect(friendRequests(db, c).requests).toEqual([]);
    expect(acceptAllFriendRequests(db, env, c)).toEqual({ accepted: 0 });
  });
});

describe("unfriend", () => {
  it("removes both directions at once, and reports strangers as not removed", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");
    const env = envWithSeats([]);

    const { id } = sendFriendRequest(db, env, a, { accountId: b });
    acceptFriendRequest(db, env, b, id);

    expect(unfriend(db, b, a)).toEqual({ removed: true });
    expect(unfriend(db, a, b)).toEqual({ removed: false });
    expect(unfriend(db, a, c)).toEqual({ removed: false });
  });
});

describe("heartbeat", () => {
  it("delivers each pending invite exactly once, and never an expired one", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const env = envWithSeats([]);

    const { id } = sendFriendRequest(db, env, a, { accountId: b });
    acceptFriendRequest(db, env, b, id);
    inviteFriend(db, env, a, { accountId: b, lobby: { kind: "private", code: "ABC123" } });

    const first = heartbeat(db, env, b);
    expect(first).toEqual({
      ok: true,
      invites: [
        {
          id: expect.any(String),
          fromAccountId: a,
          fromDisplayName: "Amy",
          fromColor: 0,
          lobby: { kind: "private", code: "ABC123" },
          sentAt: NOW,
        },
      ],
    });
    expect(heartbeat(db, env, b).invites).toEqual([]);
  });

  it("an invite past expiry never surfaces", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const env = envWithSeats([]);

    const { id } = sendFriendRequest(db, env, a, { accountId: b });
    acceptFriendRequest(db, env, b, id);
    inviteFriend(db, env, a, { accountId: b, lobby: { kind: "public", lobbyId: "lobby-9" } });

    const lateEnv: FriendsEnv = { ...env, now: () => NOW + 60 * 60_000 };
    expect(heartbeat(db, lateEnv, b).invites).toEqual([]);
  });
});

describe("friendsOverview", () => {
  const befriend = (env: FriendsEnv, from: string, to: string): void => {
    const { id } = sendFriendRequest(db, env, from, { accountId: to });
    acceptFriendRequest(db, env, to, id);
  };

  it("derives presence from seats first, beats second — with counts and requests", async () => {
    const me = makeAccount("Me");
    const seated = makeAccount("Seated");
    const racing = makeAccount("Racing");
    const fresh = makeAccount("Fresh");
    const stale = makeAccount("Stale");
    const ghost = makeAccount("Ghost");
    const stranger = makeAccount("Stranger");
    const env = envWithSeats([
      seat({ accountIds: [seated] }),
      seat({ phase: "RUNNING", round: 2, accountIds: [racing], isPrivate: true, code: "SEAT42" }),
    ]);
    for (const friend of [seated, racing, fresh, stale, ghost]) befriend(env, me, friend);
    sendFriendRequest(db, env, stranger, { accountId: me });

    recordBeat(db, fresh, NOW - 10_000);
    recordBeat(db, stale, NOW - 120_000);
    recordBeat(db, racing, NOW - 10_000);

    const overview = await friendsOverview(db, env, me);
    expect(overview.total).toBe(5);
    expect(overview.online).toBe(4);
    expect(overview.requests.map((r) => r.fromAccountId)).toEqual([stranger]);
    const byId = new Map(overview.friends.map((f) => [f.accountId, f]));
    expect(byId.get(seated)!.presence).toEqual({
      status: "in-lobby",
      slotsOpen: 6,
      joinable: true,
      lobby: { kind: "public", lobbyId: "lobby-1" },
    });
    expect(byId.get(racing)!.presence).toEqual({ status: "in-match", round: 2 });
    expect(byId.get(fresh)!.presence).toEqual({ status: "online" });
    expect(byId.get(stale)!.presence.status).toBe("idle");
    expect(byId.get(ghost)!.presence).toEqual({ status: "offline" });
  });

  it("a full Lobby keeps its ref but reads not joinable", async () => {
    const me = makeAccount("Me");
    const full = makeAccount("Full");
    const env = envWithSeats([seat({ playerCount: 8, accountIds: [full] })]);
    befriend(env, me, full);

    const overview = await friendsOverview(db, env, me);
    expect(overview.friends[0]!.presence).toEqual({
      status: "in-lobby",
      slotsOpen: 0,
      lobby: { kind: "public", lobbyId: "lobby-1" },
      joinable: false,
    });
    expect(overview.online).toBe(1);
  });
});

describe("inviteFriend", () => {
  it("refuses malformed refs, self-invites, unknowns, and strangers", async () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const env = envWithSeats([]);

    await expectServiceError(() => inviteFriend(db, env, a, { accountId: b, lobby: { kind: "private" } }), 400);
    await expectServiceError(
      () => inviteFriend(db, env, a, { accountId: b, lobby: { kind: "public" } }),
      400,
    );
    await expectServiceError(() => inviteFriend(db, env, a, { accountId: b, lobby: null }), 400);
    await expectServiceError(() => inviteFriend(db, env, a, { lobby: { kind: "public", lobbyId: "l" } }), 400);
    await expectServiceError(
      () => inviteFriend(db, env, a, { accountId: a, lobby: { kind: "public", lobbyId: "l" } }),
      400,
    );
    await expectServiceError(
      () => inviteFriend(db, env, a, { accountId: "ghost", lobby: { kind: "public", lobbyId: "l" } }),
      404,
    );
    await expectServiceError(
      () => inviteFriend(db, env, a, { accountId: b, lobby: { kind: "public", lobbyId: "l" } }),
      403,
    );
  });
});

describe("recentPlayers", () => {
  it("lists co-players most recent first — friends and strangers alike", () => {
    const me = makeAccount("Me");
    const old = makeAccount("Old");
    const newFriend = makeAccount("New");
    const env = envWithSeats([]);

    saveMatchResult(db, RESULT("m1", { p1: me, p2: old }, 1_000));
    saveMatchResult(db, RESULT("m2", { p1: me, p2: old }, 2_000));
    saveMatchResult(db, RESULT("m3", { p1: me, p2: newFriend }, 3_000));
    const { id } = sendFriendRequest(db, env, me, { accountId: newFriend });
    acceptFriendRequest(db, env, newFriend, id);

    expect(recentPlayers(db, me)).toEqual({
      recent: [
        {
          accountId: newFriend,
          displayName: "New",
          avatarUrl: null,
          color: 0,
          matchesTogether: 1,
          lastPlayedAt: 3_000,
        },
        { accountId: old, displayName: "Old", avatarUrl: null, color: 0, matchesTogether: 2, lastPlayedAt: 2_000 },
      ],
    });
    expect(recentPlayers(db, makeAccount("Lonely")).recent).toEqual([]);
  });
});
