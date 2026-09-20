import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_SOCKET_REPLACED,
  ACCOUNT_SOCKET_UNAUTHORIZED,
  type LobbyInviteView,
  type PartyInviteView,
  type PartyMemberView,
  type PartyView,
} from "@dont-fall/shared";
import { connectFakeAccountSocket, fakeAccountSockets } from "../../test/fakeAccountSocket.js";
import {
  accountSocketUrl,
  dismissLobbyInvite,
  dismissPartyInvite,
  getAccountSocketSnapshot,
  onAccountSocketEvent,
  partyStateOf,
  sendPlace,
  startAccountSocket,
  type AccountSocketEvent,
} from "./accountSocket.js";

const member = (accountId: string, displayName: string, overrides: Partial<PartyMemberView> = {}): PartyMemberView => ({
  accountId,
  displayName,
  color: 1,
  skin: null,
  hat: null,
  avatarUploadedAt: null,
  xp: 0,
  joinedAt: 1,
  place: "menu",
  online: true,
  ...overrides,
});

const party = (hostAccountId: string, members: PartyMemberView[]): PartyView => ({
  id: "p1",
  hostAccountId,
  members,
  pending: [],
  code: null,
  codeExpiresAt: null,
  lobby: null,
});

const PARTY_INVITE: PartyInviteView = {
  id: "pi1",
  partyId: "p9",
  fromAccountId: "a2",
  fromDisplayName: "Floppo",
  fromColor: 2,
  fromAvatarUploadedAt: null,
  partySize: 2,
  sentAt: 1,
};

const LOBBY_INVITE: LobbyInviteView = {
  id: "li1",
  fromAccountId: "a2",
  fromDisplayName: "Floppo",
  fromColor: 2,
  lobby: { kind: "public", lobbyId: "l1" },
  sentAt: 1,
};

let stops: (() => void)[] = [];
const track = <T extends { stop: () => void }>(connected: T): T => {
  stops.push(connected.stop);
  return connected;
};

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  sendPlace("menu");
  vi.useRealTimers();
});

describe("accountSocketUrl (ADR 0112)", () => {
  it("dials the API's own origin at /account — ws locally", () => {
    expect(accountSocketUrl("http://localhost:8081", "http://localhost:5173/")).toBe("ws://localhost:8081/account");
  });

  it("keeps the online proxy base, and goes wss over https", () => {
    expect(accountSocketUrl("https://x-8088.app.github.dev/api", "https://x-8088.app.github.dev/lobby")).toBe(
      "wss://x-8088.app.github.dev/api/account",
    );
  });

  it("reads a bare-path base against the page", () => {
    expect(accountSocketUrl("/api", "https://play.example/menu")).toBe("wss://play.example/api/account");
  });
});

describe("the Account socket (ADR 0112)", () => {
  it("signs in with the token as its first message once open — never in the URL", () => {
    const fakes = fakeAccountSockets();
    stops.push(startAccountSocket({ createSocket: fakes.createSocket, url: "ws://test/account", getToken: () => "tok-1" }));
    const socket = fakes.latest();

    expect(socket.url).toBe("ws://test/account");
    expect(getAccountSocketSnapshot().status).toBe("connecting");
    expect(socket.sent).toEqual([]);

    socket.open();
    expect(socket.sent).toEqual([{ type: "auth", token: "tok-1" }]);

    socket.deliver({ type: "ready", accountId: "me" });
    expect(getAccountSocketSnapshot()).toMatchObject({ status: "open", accountId: "me" });
  });

  it("holds the Party, Party invites and Lobby invites the API pushes", () => {
    const { socket } = track(connectFakeAccountSocket());

    const view = party("me", [member("me", "Noodle")]);
    socket.deliver({ type: "party", party: view });
    socket.deliver({ type: "partyInvite", invite: PARTY_INVITE });
    socket.deliver({ type: "partyInvite", invite: PARTY_INVITE }); // pushed twice — held once
    socket.deliver({ type: "lobbyInvite", invite: LOBBY_INVITE });
    socket.deliver({ type: "lobbyInvite", invite: LOBBY_INVITE });

    expect(getAccountSocketSnapshot()).toMatchObject({
      party: view,
      partyInvites: [PARTY_INVITE],
      lobbyInvites: [LOBBY_INVITE],
    });

    socket.deliver({ type: "partyInviteGone", inviteId: "pi1" });
    expect(getAccountSocketSnapshot().partyInvites).toEqual([]);

    dismissLobbyInvite("li1");
    expect(getAccountSocketSnapshot().lobbyInvites).toEqual([]);

    socket.deliver({ type: "partyInvite", invite: PARTY_INVITE });
    dismissPartyInvite("pi1");
    expect(getAccountSocketSnapshot().partyInvites).toEqual([]);
  });

  it("hands follow, left and removed to its listeners — removed with the remover as last seen", () => {
    const { socket } = track(connectFakeAccountSocket());
    const events: AccountSocketEvent[] = [];
    const stop = onAccountSocketEvent((event) => events.push(event));

    const floppo = member("a2", "Floppo");
    socket.deliver({ type: "party", party: party("a2", [floppo, member("me", "Noodle")]) });
    socket.deliver({ type: "follow", lobby: { id: "l1", port: 51003 }, reservation: "r-1", hostDisplayName: "Floppo" });
    socket.deliver({ type: "left", hostDisplayName: "Floppo" });
    // The API may push the new party of one before saying why.
    socket.deliver({ type: "party", party: party("me", [member("me", "Noodle")]) });
    socket.deliver({ type: "removed", byDisplayName: "Floppo" });
    stop();

    expect(events).toEqual([
      { type: "follow", lobby: { id: "l1", port: 51003 }, reservation: "r-1", hostDisplayName: "Floppo" },
      { type: "left", hostDisplayName: "Floppo" },
      { type: "removed", byDisplayName: "Floppo", by: floppo },
    ]);
  });

  it("says where it is once signed in, never the same thing twice, and again after a redial", () => {
    vi.useFakeTimers();
    const fakes = fakeAccountSockets();
    stops.push(startAccountSocket({ createSocket: fakes.createSocket, url: "ws://test/account", getToken: () => "tok-1" }));
    const first = fakes.latest();

    // Before `ready` nothing is said: the API has not placed this socket yet.
    sendPlace("lobby", 51003);
    first.open();
    expect(first.sent).toEqual([{ type: "auth", token: "tok-1" }]);

    first.deliver({ type: "ready", accountId: "me" });
    sendPlace("lobby", 51003);
    sendPlace("match", 51003);
    sendPlace("match", 51003);
    expect(first.sent.slice(1)).toEqual([
      { type: "place", place: "lobby", lobbyPort: 51003 },
      { type: "place", place: "match", lobbyPort: 51003 },
    ]);

    first.drop();
    vi.advanceTimersByTime(1_000);
    const second = fakes.latest();
    expect(second).not.toBe(first);
    second.open();
    second.deliver({ type: "ready", accountId: "me" });
    expect(second.sent).toEqual([
      { type: "auth", token: "tok-1" },
      { type: "place", place: "match", lobbyPort: 51003 },
    ]);
  });

  it("redials after a drop on a doubling, capped backoff — reset once it is signed in again", () => {
    vi.useFakeTimers();
    const fakes = fakeAccountSockets();
    stops.push(startAccountSocket({ createSocket: fakes.createSocket, url: "ws://test/account", getToken: () => "tok-1" }));

    const waits: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const before = fakes.sockets.length;
      fakes.latest().drop();
      expect(getAccountSocketSnapshot().status).toBe("connecting");
      let waited = 0;
      while (fakes.sockets.length === before) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);

    fakes.latest().open();
    fakes.latest().deliver({ type: "ready", accountId: "me" });
    fakes.latest().drop();
    vi.advanceTimersByTime(1_000);
    expect(fakes.sockets).toHaveLength(8);
  });

  it("keeps what it held while it redials — a blip must not flicker the Party", () => {
    vi.useFakeTimers();
    const { socket } = track(connectFakeAccountSocket());
    const view = party("me", [member("me", "Noodle")]);
    socket.deliver({ type: "party", party: view });

    socket.drop();

    expect(getAccountSocketSnapshot()).toMatchObject({ status: "connecting", party: view });
  });

  it("takes the Party invites sent after each ready as the whole list — one that went while it was down is gone; Lobby invites stay", () => {
    vi.useFakeTimers();
    const { socket, latest } = track(connectFakeAccountSocket());
    const stillLive = { ...PARTY_INVITE, id: "pi2" };
    socket.deliver({ type: "partyInvite", invite: PARTY_INVITE });
    socket.deliver({ type: "partyInvite", invite: stillLive });
    socket.deliver({ type: "lobbyInvite", invite: LOBBY_INVITE });

    // pi1 expires while the socket is down: no `partyInviteGone` ever reaches
    // this client, and the API re-sends only pi2 on connect.
    socket.drop();
    expect(getAccountSocketSnapshot().partyInvites).toEqual([PARTY_INVITE, stillLive]);
    vi.advanceTimersByTime(1_000);
    const redialed = latest();
    redialed.open();
    redialed.deliver({ type: "ready", accountId: "me" });
    redialed.deliver({ type: "partyInvite", invite: stillLive });

    // Only an undelivered Lobby invite is sent again, so the ones held are kept.
    expect(getAccountSocketSnapshot()).toMatchObject({ partyInvites: [stillLive], lobbyInvites: [LOBBY_INVITE] });
  });

  it("stops for good when a newer tab takes the socket over, and says so", () => {
    vi.useFakeTimers();
    const { socket, sockets } = track(connectFakeAccountSocket());
    const events: AccountSocketEvent[] = [];
    const stop = onAccountSocketEvent((event) => events.push(event));

    socket.drop(ACCOUNT_SOCKET_REPLACED);
    vi.advanceTimersByTime(60_000);
    stop();

    expect(sockets).toHaveLength(1);
    expect(getAccountSocketSnapshot().status).toBe("replaced");
    expect(events).toEqual([{ type: "replaced" }]);
  });

  it("stops for good on a token the API could not resolve", () => {
    vi.useFakeTimers();
    const { socket, sockets } = track(connectFakeAccountSocket());

    socket.drop(ACCOUNT_SOCKET_UNAUTHORIZED);
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(getAccountSocketSnapshot().status).toBe("unauthorized");
  });

  it("closes and forgets everything on sign-out, and never redials", () => {
    vi.useFakeTimers();
    const { socket, sockets, stop } = connectFakeAccountSocket();
    socket.deliver({ type: "party", party: party("me", [member("me", "Noodle")]) });
    socket.deliver({ type: "lobbyInvite", invite: LOBBY_INVITE });

    stop();
    vi.advanceTimersByTime(60_000);

    expect(socket.closed).toBe(true);
    expect(sockets).toHaveLength(1);
    expect(getAccountSocketSnapshot()).toEqual({
      status: "closed",
      accountId: null,
      party: null,
      partyInvites: [],
      lobbyInvites: [],
    });
  });

  it("keeps one socket per page — a second start closes the first", () => {
    const first = connectFakeAccountSocket();
    const second = track(connectFakeAccountSocket());

    expect(first.socket.closed).toBe(true);
    expect(second.socket.closed).toBe(false);
    expect(getAccountSocketSnapshot().status).toBe("open");
  });
});

describe("partyStateOf (ADR 0112)", () => {
  it("is a party of one you host before the Party has arrived", () => {
    expect(partyStateOf({ party: null, accountId: null })).toMatchObject({
      isHost: true,
      host: null,
      members: [],
      others: [],
      size: 1,
      waitingFor: null,
    });
  });

  it("names the host, the others, and whom the host waits for", () => {
    const host = member("a2", "Floppo");
    const goopy = member("a3", "Goopy", { place: "match" });
    const view = party("a2", [host, member("me", "Noodle"), goopy]);

    const mine = partyStateOf({ party: view, accountId: "me" });
    expect(mine).toMatchObject({ isHost: false, host, size: 3, waitingFor: goopy });
    expect(mine.others.map((m) => m.displayName)).toEqual(["Floppo", "Goopy"]);

    expect(partyStateOf({ party: view, accountId: "a2" })).toMatchObject({ isHost: true, waitingFor: goopy });
  });

  it("does not wait for a member whose game is closed", () => {
    // The API keeps a dropped-out bean for its grace with the place they last
    // reported. The strip says OFFLINE; PLAY must not read WAITING FOR them.
    const gone = member("a3", "Goopy", { place: "lobby", online: false });
    const view = party("me", [member("me", "Noodle"), gone]);

    expect(partyStateOf({ party: view, accountId: "me" }).waitingFor).toBeNull();

    // Back online in that same Lobby, they hold PLAY again.
    const back = party("me", [member("me", "Noodle"), { ...gone, online: true }]);
    expect(partyStateOf({ party: back, accountId: "me" }).waitingFor).toMatchObject({ accountId: "a3" });
  });
});
