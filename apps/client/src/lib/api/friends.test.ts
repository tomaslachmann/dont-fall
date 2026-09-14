import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptAllFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  getFriendsOverview,
  getOwnFriendCode,
  getRecentPlayers,
  postHeartbeat,
  removeFriend,
  sendFriendRequest,
  sendLobbyInvite,
} from "./friends.js";

const API = "http://localhost:8081"; // the single API (ADR 0058)

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("friends api", () => {
  it("reads the overview, recent, and own code off their GETs", async () => {
    const fetchMock = respond(200, { friends: [], online: 0, total: 0, requests: [] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getFriendsOverview()).resolves.toEqual({ friends: [], online: 0, total: 0, requests: [] });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API}/friends`);

    vi.stubGlobal("fetch", respond(200, { recent: [] }));
    await expect(getRecentPlayers()).resolves.toEqual({ recent: [] });

    vi.stubGlobal("fetch", respond(200, { code: "BEAN42" }));
    await expect(getOwnFriendCode()).resolves.toEqual({ code: "BEAN42" });
  });

  it("heartbeats with no body, and surfaces arriving invites", async () => {
    const invites = [{ id: "i1", fromAccountId: "a", fromDisplayName: "Amy", lobby: { kind: "public", lobbyId: "l1" }, sentAt: 1 }];
    const fetchMock = respond(200, { ok: true, invites });
    vi.stubGlobal("fetch", fetchMock);

    await expect(postHeartbeat()).resolves.toEqual({ ok: true, invites });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/friends/heartbeat`);
    expect(init).toMatchObject({ method: "POST" });
  });

  it("sends requests by code or account id, and answers the inbox", async () => {
    const fetchMock = respond(201, { id: "r1" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendFriendRequest({ code: "bean42" })).resolves.toEqual({ id: "r1" });
    let [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ code: "bean42" });

    await expect(sendFriendRequest({ accountId: "a1" })).resolves.toEqual({ id: "r1" });
    [, init] = fetchMock.mock.calls[1]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ accountId: "a1" });

    vi.stubGlobal("fetch", respond(200, { friend: { accountId: "a1", displayName: "Amy", avatarUrl: null } }));
    await expect(acceptFriendRequest("r1")).resolves.toMatchObject({ friend: { displayName: "Amy" } });

    vi.stubGlobal("fetch", respond(200, { id: "r1" }));
    await expect(declineFriendRequest("r1")).resolves.toEqual({ id: "r1" });

    vi.stubGlobal("fetch", respond(200, { accepted: 2 }));
    await expect(acceptAllFriendRequests()).resolves.toEqual({ accepted: 2 });
  });

  it("invites and removes over their own endpoints", async () => {
    const fetchMock = respond(201, { id: "i1" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendLobbyInvite({ accountId: "a1", lobby: { kind: "private", code: "PLUMJA" } }),
    ).resolves.toEqual({ id: "i1" });
    const [inviteUrl, inviteInit] = fetchMock.mock.calls[0]!;
    expect(inviteUrl).toBe(`${API}/friends/invite`);
    expect(JSON.parse((inviteInit as RequestInit).body as string)).toEqual({
      accountId: "a1",
      lobby: { kind: "private", code: "PLUMJA" },
    });

    const deleteMock = respond(200, { removed: true });
    vi.stubGlobal("fetch", deleteMock);
    await expect(removeFriend("a1")).resolves.toEqual({ removed: true });
    const [deleteUrl, deleteInit] = deleteMock.mock.calls[0]!;
    expect(deleteUrl).toBe(`${API}/friends/a1`);
    expect(deleteInit).toMatchObject({ method: "DELETE" });
  });

  it("carries the server's own reason on a refusal", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "already friends" }));
    await expect(sendFriendRequest({ accountId: "a1" })).rejects.toThrow("already friends");
  });
});
