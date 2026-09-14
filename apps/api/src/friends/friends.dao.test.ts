import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword } from "../auth/accounts.dao.js";
import {
  acceptAllRequests,
  acceptRequest,
  accountIdByFriendCode,
  areFriends,
  beatsFor,
  coPlayedWith,
  createInvite,
  declineRequest,
  ensureFriendCode,
  incomingRequests,
  listFriends,
  markInvitesDelivered,
  pendingBetween,
  pendingInvites,
  recordBeat,
  removeFriendship,
  sendRequest,
} from "./friends.dao.js";
import { saveMatchResult } from "../matches/matches.service.js";

let dir: string;
let db: ApiDb;

const makeAccount = (name: string): string =>
  createAccountWithPassword(db, { email: `${name}@example.com`, password: "password-123", displayName: name }).id;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "api-friends-test-"));
  db = openDb(join(dir, "test.sqlite"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("friend codes", () => {
  it("generates a readable 6-char code lazily, stable across reads", () => {
    const id = makeAccount("Wobble");

    const first = ensureFriendCode(db, id);
    expect(first).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(ensureFriendCode(db, id)).toBe(first);
  });

  it("resolves a code back to its Account, case-insensitively — unknown codes miss", () => {
    const id = makeAccount("Wobble");
    const code = ensureFriendCode(db, id);

    expect(accountIdByFriendCode(db, code.toLowerCase())).toBe(id);
    expect(accountIdByFriendCode(db, "ZZZZZZ")).toBeUndefined();
  });

  it("codes are unique across Accounts", () => {
    const codes = new Set(
      Array.from({ length: 25 }, (_, n) => ensureFriendCode(db, makeAccount(`bean${n}`))),
    );
    expect(codes.size).toBe(25);
  });
});

describe("friend requests", () => {
  it("sends, lists incoming with the sender's name, and accepts into a friendship", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");

    const id = sendRequest(db, a, b, 1_000);
    expect(typeof id).toBe("string");
    expect(pendingBetween(db, a, b)).toBe(true);
    expect(pendingBetween(db, b, a)).toBe(true);
    expect(areFriends(db, a, b)).toBe(false);

    expect(incomingRequests(db, b)).toEqual([
      { id, fromAccountId: a, fromDisplayName: "Amy", fromAvatarUrl: null, createdAt: 1_000 },
    ]);
    expect(incomingRequests(db, a)).toEqual([]);

    expect(acceptRequest(db, id, b, 2_000)).toBe(a);
    expect(areFriends(db, a, b)).toBe(true);
    expect(areFriends(db, b, a)).toBe(true);
    expect(pendingBetween(db, a, b)).toBe(false);
    expect(incomingRequests(db, b)).toEqual([]);
  });

  it("a double-send fails at the DB, not with a second row", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");

    sendRequest(db, a, b, 1_000);
    expect(() => sendRequest(db, a, b, 2_000)).toThrow();
    expect(incomingRequests(db, b)).toHaveLength(1);
  });

  it("accepting clears the cross-direction race too — no orphan request survives", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");

    const first = sendRequest(db, a, b, 1_000);
    sendRequest(db, b, a, 1_001);

    expect(acceptRequest(db, first, b, 2_000)).toBe(a);
    expect(pendingBetween(db, a, b)).toBe(false);
    expect(incomingRequests(db, a)).toEqual([]);
  });

  it("accepting someone else's request — or a phantom id — reports false and changes nothing", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");

    const id = sendRequest(db, a, b, 1_000);
    expect(acceptRequest(db, id, c, 2_000)).toBeNull();
    expect(acceptRequest(db, "no-such-request", b, 2_000)).toBeNull();
    expect(areFriends(db, a, b)).toBe(false);
    expect(incomingRequests(db, b)).toHaveLength(1);
  });

  it("declining removes the request without befriending — and re-requesting works after", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");

    const id = sendRequest(db, a, b, 1_000);
    expect(declineRequest(db, id, b)).toBe(true);
    expect(declineRequest(db, id, b)).toBe(false);
    expect(areFriends(db, a, b)).toBe(false);

    sendRequest(db, a, b, 2_000);
    expect(incomingRequests(db, b)).toHaveLength(1);
  });

  it("accept-all befriends every pending sender and reports them", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");

    sendRequest(db, a, c, 1_000);
    sendRequest(db, b, c, 1_001);

    expect(acceptAllRequests(db, c, 2_000).sort()).toEqual([a, b].sort());
    expect(areFriends(db, a, c)).toBe(true);
    expect(areFriends(db, b, c)).toBe(true);
    expect(incomingRequests(db, c)).toEqual([]);
    expect(acceptAllRequests(db, c, 3_000)).toEqual([]);
  });
});

describe("friendships", () => {
  it("lists both directions with names and formation time", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");

    const id = sendRequest(db, a, b, 1_000);
    acceptRequest(db, id, b, 2_000);

    expect(listFriends(db, a)).toEqual([{ accountId: b, displayName: "Bo", avatarUrl: null, friendsSince: 2_000 }]);
    expect(listFriends(db, b)).toEqual([{ accountId: a, displayName: "Amy", avatarUrl: null, friendsSince: 2_000 }]);
  });

  it("removes either way around, and reports strangers as not removed", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");

    const id = sendRequest(db, a, b, 1_000);
    acceptRequest(db, id, b, 2_000);

    expect(removeFriendship(db, b, a)).toBe(true);
    expect(areFriends(db, a, b)).toBe(false);
    expect(listFriends(db, a)).toEqual([]);
    expect(removeFriendship(db, a, c)).toBe(false);
  });
});

describe("presence beats", () => {
  it("records and reads last beats per Account — missing Accounts simply miss", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");

    recordBeat(db, a, 1_000);
    recordBeat(db, b, 2_000);
    recordBeat(db, a, 3_000);

    expect(beatsFor(db, [a, b, c])).toEqual(
      new Map([
        [a, 3_000],
        [b, 2_000],
      ]),
    );
    expect(beatsFor(db, [])).toEqual(new Map());
  });
});

describe("coPlayedWith", () => {
  const RESULT = (matchId: string, accountIds: Record<string, string>, endedAtMs: number) => ({
    matchId,
    results: [{ rows: [{ id: "p1", placement: 1, qualified: true }] }],
    nicknames: { p1: "X" },
    accountIds,
    totalFalls: {},
    endedAtMs,
  });

  it("counts shared finished Matches per Account, latest first — pre-2b rows contribute nothing", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");
    const c = makeAccount("Cy");

    saveMatchResult(db, RESULT("m1", { p1: a, p2: b }, 1_000));
    saveMatchResult(db, RESULT("m2", { p1: a, p2: b }, 2_000));
    saveMatchResult(db, RESULT("m3", { p1: a, p2: c }, 3_000));
    saveMatchResult(db, { ...RESULT("m4", {}, 4_000), accountIds: undefined });

    const co = coPlayedWith(db, a);
    expect(co.size).toBe(2);
    expect(co.get(b)).toEqual({ matchesTogether: 2, lastPlayedAt: 2_000 });
    expect(co.get(c)).toEqual({ matchesTogether: 1, lastPlayedAt: 3_000 });
    expect(co.has(a)).toBe(false);
    expect(coPlayedWith(db, "ghost")).toEqual(new Map());
  });
});

describe("lobby invites", () => {
  it("an invite is read once, then marked delivered — and expires lazily", () => {
    const a = makeAccount("Amy");
    const b = makeAccount("Bo");

    const id = createInvite(db, {
      fromAccountId: a,
      toAccountId: b,
      lobbyRef: { kind: "private", code: "ABC123" },
      createdAt: 1_000,
      expiresAt: 2_000,
    });

    expect(pendingInvites(db, b, 1_500)).toEqual([
      {
        id,
        fromAccountId: a,
        fromDisplayName: "Amy",
        lobbyRef: { kind: "private", code: "ABC123" },
        createdAt: 1_000,
      },
    ]);

    markInvitesDelivered(db, [id], 1_500);
    expect(pendingInvites(db, b, 1_600)).toEqual([]);

    // An undelivered invite past expiry never surfaces — and is pruned by the read.
    createInvite(db, {
      fromAccountId: a,
      toAccountId: b,
      lobbyRef: { kind: "public", lobbyId: "lobby-1" },
      createdAt: 1_000,
      expiresAt: 1_100,
    });
    expect(pendingInvites(db, b, 1_500)).toEqual([]);
    expect(pendingInvites(db, b, 1_600)).toEqual([]);
  });
});
