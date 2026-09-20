// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router";
import type { AccountServerMessage, PartyInviteView } from "@dont-fall/shared";
import GlobalAlerts from "./GlobalAlerts";
import { ApiError } from "../lib/api/base.js";
import { clearFlashes } from "../lib/flash.js";
import { setGameActive } from "../lib/gamePresence.js";
import { connectFakeAccountSocket, type FakeAccountSocket } from "../test/fakeAccountSocket.js";

const { useFriends } = vi.hoisted(() => ({ useFriends: vi.fn() }));
vi.mock("../lib/hooks/useFriends.js", () => ({ useFriends }));

const { resolveLobbyRef } = vi.hoisted(() => ({ resolveLobbyRef: vi.fn() }));
vi.mock("../lib/api/lobbyBroker.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveLobbyRef,
}));

const { acceptPartyInvite, declinePartyInvite } = vi.hoisted(() => ({
  acceptPartyInvite: vi.fn(),
  declinePartyInvite: vi.fn(),
}));
vi.mock("../lib/api/party.js", () => ({ acceptPartyInvite, declinePartyInvite }));

const REQUEST = {
  id: "r1",
  fromAccountId: "a5",
  fromDisplayName: "Goopy",
  fromAvatarUrl: null,
  fromColor: 0,
  sentAt: 1,
  matchesTogether: 4,
};

const INVITE = {
  id: "i1",
  fromAccountId: "a2",
  fromDisplayName: "Floppo",
  fromColor: 0,
  lobby: { kind: "public", lobbyId: "l1" } as const,
  sentAt: 1,
};

const PARTY_INVITE: PartyInviteView = {
  id: "pi1",
  partyId: "p9",
  fromAccountId: "a7",
  fromDisplayName: "Wiggly",
  fromColor: 3,
  fromAvatarUploadedAt: null,
  partySize: 2,
  sentAt: 1,
};

const hook = (overrides = {}) => ({
  friends: [],
  online: 0,
  total: 0,
  requests: [REQUEST],
  recent: [],
  code: null,
  requestedIds: [],
  isLoading: false,
  error: null,
  retry: vi.fn(),
  sendRequest: vi.fn().mockResolvedValue(undefined),
  acceptRequest: vi.fn().mockResolvedValue({ displayName: "Goopy" }),
  declineRequest: vi.fn().mockResolvedValue(undefined),
  acceptAll: vi.fn().mockResolvedValue(1),
  unfriend: vi.fn().mockResolvedValue(true),
  invite: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

/** Reads back the query `/lobby` was reached with — the join's own params. */
const LobbyProbe = () => {
  const [params] = useSearchParams();
  return <div>{`lobby:${params.get("port")}|${params.get("code")}|${params.get("reservation")}`}</div>;
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      {/* Mounted once above the routes, like the AuthGate shell mounts it. */}
      <GlobalAlerts />
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/settings" element={<div>settings</div>} />
        <Route path="/friends" element={<div>friends</div>} />
        <Route path="/lobby" element={<LobbyProbe />} />
      </Routes>
    </MemoryRouter>,
  );

/** The Account socket, signed in — what the API pushes arrives through it (ADR 0112). */
let account: ReturnType<typeof connectFakeAccountSocket>;
let socket: FakeAccountSocket;
const push = (message: AccountServerMessage): void => act(() => socket.deliver(message));

describe("GlobalAlerts", () => {
  beforeEach(() => {
    clearFlashes();
    setGameActive(false);
    useFriends.mockReturnValue(hook());
    account = connectFakeAccountSocket("me");
    socket = account.socket;
    socket.deliver({ type: "lobbyInvite", invite: INVITE });
  });

  afterEach(() => {
    account.stop();
    clearFlashes();
    setGameActive(false);
  });

  it("shows friend requests and Lobby invites on a menu route", () => {
    renderAt("/");

    expect(screen.getByText("GOOPY WANTS IN")).toBeInTheDocument();
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });

  it("the invite survives navigation — it is global, not one Screen's", () => {
    const { unmount } = renderAt("/");
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
    unmount();

    renderAt("/settings");
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });

  it("on /friends the requests stay inline — only invites overlay", () => {
    renderAt("/friends");

    expect(screen.queryByText("GOOPY WANTS IN")).not.toBeInTheDocument();
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });

  it("JOIN resolves the invite's Lobby and lands in it, with the seat it reserved", async () => {
    resolveLobbyRef.mockResolvedValue({ id: "l1", port: 61000, reservation: "r-9" });
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));

    // The invite dismisses only once the Lobby resolves, then lands in it.
    expect(await screen.findByText("lobby:61000|null|r-9")).toBeInTheDocument();
    expect(screen.queryByText("FLOPPO INVITED YOU")).not.toBeInTheDocument();
  });

  it("a failed JOIN stays put and flashes why — and the invite stays up", async () => {
    resolveLobbyRef.mockRejectedValue(new Error("that Lobby is no longer joinable"));
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));

    expect(await screen.findByText("that Lobby is no longer joinable")).toBeInTheDocument();
    expect(screen.getByText("HOLD ON")).toBeInTheDocument();
    // No game started and nothing was answered — the invite must survive.
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
    expect(screen.queryByText(/lobby:/)).not.toBeInTheDocument();
  });

  it("accepting from the alert flashes the new friendship; a failure flashes why", async () => {
    const fns = hook();
    useFriends.mockReturnValue(fns);
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "Accept Goopy" }));
    expect(await screen.findByText("Goopy is now your friend.")).toBeInTheDocument();

    fns.acceptRequest.mockRejectedValueOnce(new Error("request expired"));
    fireEvent.click(screen.getByRole("button", { name: "Accept Goopy" }));
    expect(await screen.findByText("request expired")).toBeInTheDocument();
  });

  it("dismissing an invite drops it without navigating", () => {
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss invite from Floppo" }));

    expect(screen.queryByText("FLOPPO INVITED YOU")).not.toBeInTheDocument();
    expect(screen.queryByText(/lobby:/)).not.toBeInTheDocument();
  });

  it("hides the social alerts while a game owns the screen — flashes still show", async () => {
    renderAt("/");
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();

    // A failed JOIN's error flash must survive the game starting underneath.
    resolveLobbyRef.mockRejectedValue(new Error("that Lobby is no longer joinable"));
    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));
    expect(await screen.findByText("that Lobby is no longer joinable")).toBeInTheDocument();

    act(() => setGameActive(true));
    await waitFor(() => expect(screen.queryByText("FLOPPO INVITED YOU")).not.toBeInTheDocument());
    expect(screen.queryByText("GOOPY WANTS IN")).not.toBeInTheDocument();
    expect(screen.getByText("that Lobby is no longer joinable")).toBeInTheDocument();

    act(() => setGameActive(false));
    expect(await screen.findByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });
});

describe("GlobalAlerts — the Party (ADR 0112)", () => {
  beforeEach(() => {
    clearFlashes();
    setGameActive(false);
    useFriends.mockReturnValue(hook({ requests: [] }));
    acceptPartyInvite.mockReset();
    declinePartyInvite.mockReset();
    account = connectFakeAccountSocket("me");
    socket = account.socket;
  });

  afterEach(() => {
    account.stop();
    clearFlashes();
    setGameActive(false);
  });

  it("a Party invite is the dark invite toast, kicked PARTY INVITE — JOIN accepts it", async () => {
    acceptPartyInvite.mockResolvedValue({});
    renderAt("/");
    push({ type: "partyInvite", invite: PARTY_INVITE });

    expect(screen.getByText("PARTY INVITE")).toBeInTheDocument();
    expect(screen.getByText("WIGGLY'S PARTY · 2/4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));

    expect(await screen.findByText("You're in Wiggly's party.")).toBeInTheDocument();
    expect(acceptPartyInvite).toHaveBeenCalledWith("pi1");
    expect(screen.queryByText("PARTY INVITE")).not.toBeInTheDocument();
  });

  it("a failed JOIN keeps the Party invite up and flashes why", async () => {
    acceptPartyInvite.mockRejectedValue(new ApiError("that party is full", 409));
    renderAt("/");
    push({ type: "partyInvite", invite: { ...PARTY_INVITE, partySize: 1 } });
    expect(screen.getByText("WIGGLY INVITED YOU")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));

    expect(await screen.findByText("that party is full")).toBeInTheDocument();
    expect(screen.getByText("PARTY INVITE")).toBeInTheDocument();
  });

  it("× declines the Party invite, and it goes at once", async () => {
    declinePartyInvite.mockResolvedValue(undefined);
    renderAt("/");
    push({ type: "partyInvite", invite: PARTY_INVITE });

    fireEvent.click(screen.getByRole("button", { name: "Decline party invite from Wiggly" }));

    expect(declinePartyInvite).toHaveBeenCalledWith("pi1");
    expect(screen.queryByText("PARTY INVITE")).not.toBeInTheDocument();
    // An invite already gone is what declining wanted anyway — nothing to flash.
    declinePartyInvite.mockRejectedValue(new ApiError("no such invite", 404));
    push({ type: "partyInvite", invite: { ...PARTY_INVITE, id: "pi2" } });
    fireEvent.click(screen.getByRole("button", { name: "Decline party invite from Wiggly" }));
    await waitFor(() => expect(declinePartyInvite).toHaveBeenCalledWith("pi2"));
    expect(screen.queryByText("HOLD ON")).not.toBeInTheDocument();
  });

  it("an invite the API says is gone leaves the stack", () => {
    renderAt("/");
    push({ type: "partyInvite", invite: PARTY_INVITE });
    push({ type: "partyInviteGone", inviteId: "pi1" });

    expect(screen.queryByText("PARTY INVITE")).not.toBeInTheDocument();
  });

  it("follow takes the Player into the host's Lobby with its Reservation — even while a game owns the screen", async () => {
    act(() => setGameActive(true));
    renderAt("/");

    push({ type: "follow", lobby: { id: "l4", port: 51007 }, reservation: "r-1", hostDisplayName: "Floppo" });

    expect(await screen.findByText("lobby:51007|null|r-1")).toBeInTheDocument();
    expect(screen.getByText("Following Floppo into their Lobby.")).toBeInTheDocument();
  });

  it("follow into a private Lobby keeps its join code, so the Lobby Screen shows it and invites by it", async () => {
    renderAt("/");

    push({ type: "follow", lobby: { id: "l5", port: 51008, code: "PLUMJA" }, reservation: "r-2", hostDisplayName: "Floppo" });

    expect(await screen.findByText("lobby:51008|PLUMJA|r-2")).toBeInTheDocument();
  });

  it("left brings a Player still in that Lobby back to the menu, naming who left", async () => {
    renderAt("/lobby?port=51007&reservation=r-1");
    push({ type: "left", hostDisplayName: "Floppo" });

    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(screen.getByText("Floppo left the Lobby.")).toBeInTheDocument();
  });

  it("left does not move a Player who is already in the menus", () => {
    renderAt("/settings");
    push({ type: "left", hostDisplayName: "Floppo" });

    expect(screen.getByText("settings")).toBeInTheDocument();
    expect(screen.getByText("Floppo left the Lobby.")).toBeInTheDocument();
  });

  it("removed shows the Party mock's toast in the remover's bean, until dismissed", () => {
    renderAt("/");
    push({
      type: "party",
      party: {
        id: "p1",
        hostAccountId: "a2",
        members: [
          { accountId: "a2", displayName: "Floppo", color: 2, skin: null, hat: null, avatarUploadedAt: null, xp: 0, joinedAt: 1, place: "menu", online: true },
          { accountId: "me", displayName: "Noodle", color: 1, skin: null, hat: null, avatarUploadedAt: null, xp: 0, joinedAt: 2, place: "menu", online: true },
        ],
        pending: [],
        code: null,
        codeExpiresAt: null,
        lobby: null,
      },
    });
    push({ type: "removed", byDisplayName: "Floppo" });

    expect(screen.getByText("FLOPPO REMOVED YOU FROM THE PARTY")).toBeInTheDocument();
    expect(screen.getByText("You're on your own again — invite someone or jump into a quick match.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("FLOPPO REMOVED YOU FROM THE PARTY")).not.toBeInTheDocument();
  });

  it("a newer tab taking the socket over says so, and stays said", () => {
    renderAt("/");
    act(() => socket.drop(4010));

    expect(screen.getByText("The game is open in another tab — this one stopped hearing from your party.")).toBeInTheDocument();
    expect(screen.getByText("HOLD ON")).toBeInTheDocument();
  });
});
