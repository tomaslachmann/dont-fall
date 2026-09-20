// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router";
import type { FriendRequestView, FriendView, LobbyRef, RecentPlayerView } from "@dont-fall/shared";
import { ApiError } from "../lib/api/base.js";
import { clearFlashes } from "../lib/flash.js";
import FlashHost from "../ui/FlashHost.js";
import { FriendsRoute } from "./FriendsRoute";

const { useFriends } = vi.hoisted(() => ({ useFriends: vi.fn() }));
vi.mock("../lib/hooks/useFriends.js", () => ({ useFriends }));

const { resolveLobbyRef } = vi.hoisted(() => ({ resolveLobbyRef: vi.fn() }));
vi.mock("../lib/api/lobbyBroker.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveLobbyRef,
}));

const { inviteToParty } = vi.hoisted(() => ({ inviteToParty: vi.fn() }));
vi.mock("../lib/api/party.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  inviteToParty,
}));

const FRIENDS: FriendView[] = [
  {
    accountId: "a2",
    displayName: "Floppo",
    avatarUrl: null, color: 0,
    friendsSince: 1,
    presence: { status: "in-lobby", slotsOpen: 3, joinable: true, lobby: { kind: "public", lobbyId: "l1" } },
  },
  {
    accountId: "a3",
    displayName: "Wobbleton",
    avatarUrl: null, color: 0,
    friendsSince: 2,
    presence: { status: "in-match", round: 2 },
  },
  {
    accountId: "a4",
    displayName: "Tumbleweed",
    avatarUrl: null, color: 0,
    friendsSince: 3,
    presence: { status: "offline", lastSeenAt: Date.now() - 2 * 86_400_000 },
  },
];

/** A friend standing in the menus: not joinable, so their row wears INVITE rather than JOIN. */
const BONK: FriendView = {
  accountId: "a7",
  displayName: "Bonk",
  avatarUrl: null, color: 0,
  friendsSince: 4,
  presence: { status: "online" },
};

const REQUESTS: FriendRequestView[] = [
  { id: "r1", fromAccountId: "a5", fromDisplayName: "Goopy", fromAvatarUrl: null, fromColor: 0, sentAt: 1, matchesTogether: 4 },
];

const RECENT: RecentPlayerView[] = [
  { accountId: "a6", displayName: "Splatteo", avatarUrl: null, color: 0, matchesTogether: 2, lastPlayedAt: Date.now() - 3_600_000 },
];

const hook = (overrides = {}) => ({
  friends: FRIENDS,
  online: 1,
  total: 3,
  requests: REQUESTS,
  recent: RECENT,
  code: "BEAN42",
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
  return <div>{`lobby:${params.get("port")}|${params.get("code")}`}</div>;
};

/** Reached from the Lobby's own INVITE FRIENDS: its ref rides in navigation state. */
const IN_LOBBY = { pathname: "/friends", state: { lobbyRef: { kind: "public", lobbyId: "l9" } satisfies LobbyRef } };

const renderAt = (entry: string | { pathname: string; state: unknown }) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      {/* The shell mounts the flash stack above the routes — this test does the same. */}
      <FlashHost />
      <Routes>
        <Route path="/friends" element={<FriendsRoute />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/lobby" element={<LobbyProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe("FriendsRoute", () => {
  beforeEach(() => {
    clearFlashes();
    inviteToParty.mockReset();
    inviteToParty.mockResolvedValue({ inviteId: "inv-1" });
  });

  it("renders the hooked roster — online tab first, requests above", () => {
    useFriends.mockReturnValue(hook());
    renderAt("/friends");

    expect(screen.getByText("1 ONLINE · 3 TOTAL")).toBeInTheDocument();
    expect(screen.getByText("Floppo")).toBeInTheDocument();
    expect(screen.getByText("IN LOBBY · 3 SLOTS OPEN")).toBeInTheDocument();
    expect(screen.queryByText("Wobbleton")).not.toBeInTheDocument();
    expect(screen.getByText("Goopy")).toBeInTheDocument();
    expect(screen.getByText("PLAYED 4 MATCHES TOGETHER")).toBeInTheDocument();
  });

  it("tabs slice the roster; RECENT offers ADD per co-player", () => {
    useFriends.mockReturnValue(hook());
    renderAt("/friends");

    fireEvent.click(screen.getByRole("tab", { name: "IN A MATCH" }));
    expect(screen.getByText("Wobbleton")).toBeInTheDocument();
    expect(screen.getByText("IN A MATCH · ROUND 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "RECENT" }));
    expect(screen.getByText("Splatteo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ADD" })).toBeInTheDocument();
  });

  it("the ONLINE · TOTAL count shows who is online (ADR 0110)", () => {
    useFriends.mockReturnValue(hook());
    renderAt("/friends");

    fireEvent.click(screen.getByRole("tab", { name: "RECENT" }));
    fireEvent.click(screen.getByRole("button", { name: /ONLINE · \d+ TOTAL/ }));
    expect(screen.getByRole("tab", { name: "ONLINE" })).toHaveAttribute("aria-selected", "true");
  });

  it("accept/decline answer the request; JOIN resolves the ref and lands in the Lobby", async () => {
    const fns = hook();
    useFriends.mockReturnValue(fns);
    resolveLobbyRef.mockResolvedValue({ id: "l1", port: 61000 });
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "Accept Goopy" }));
    expect(fns.acceptRequest).toHaveBeenCalledWith("r1");
    expect(await screen.findByText("Goopy is now your friend.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));
    expect(resolveLobbyRef).toHaveBeenCalledWith({ kind: "public", lobbyId: "l1" });
    expect(await screen.findByText("lobby:61000|null")).toBeInTheDocument();
  });

  it("a failed JOIN stays put and says why, in the broker's own words", async () => {
    useFriends.mockReturnValue(hook());
    resolveLobbyRef.mockRejectedValue(new Error("that Lobby is no longer joinable"));
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));
    expect(await screen.findByText("that Lobby is no longer joinable")).toBeInTheDocument();
    expect(screen.getByText("HOLD ON")).toBeInTheDocument();
    expect(screen.queryByText(/lobby:/)).not.toBeInTheDocument();
  });

  it("ADD BY CODE sends the typed code and shows the Account's own", async () => {
    const fns = hook();
    useFriends.mockReturnValue(fns);
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "ADD BY CODE" }));
    expect(screen.getByText("YOUR CODE: BEAN42")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Friend code"), { target: { value: "goop99" } });
    fireEvent.click(screen.getByRole("button", { name: "ADD" }));
    await waitFor(() => expect(fns.sendRequest).toHaveBeenCalledWith({ code: "GOOP99" }));
  });

  it("back returns to the menu", () => {
    useFriends.mockReturnValue(hook());
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("home")).toBeInTheDocument();
  });
});

/**
 * A lone bean starts a Party from here (ADR 0112): opened from the menu, with
 * no Lobby to invite to, INVITE and INVITE ALL ONLINE send Party invites —
 * where they used to dead-end at "Join a Lobby first".
 */
describe("FriendsRoute sends Party invites from the menu (ADR 0112)", () => {
  beforeEach(() => {
    clearFlashes();
    inviteToParty.mockReset();
    inviteToParty.mockResolvedValue({ inviteId: "inv-1" });
  });

  it("INVITE invites that bean to the Party, not to a Lobby", async () => {
    const fns = hook({ friends: [...FRIENDS, BONK] });
    useFriends.mockReturnValue(fns);
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "INVITE" }));
    await waitFor(() => expect(inviteToParty).toHaveBeenCalledWith("a7"));
    expect(fns.invite).not.toHaveBeenCalled();
    expect(await screen.findByText("Invite sent.")).toBeInTheDocument();
  });

  it("a bean still in a Match can be invited — the Party takes them (ADR 0112)", async () => {
    useFriends.mockReturnValue(hook());
    renderAt("/friends");

    fireEvent.click(screen.getByRole("tab", { name: "IN A MATCH" }));
    const invite = screen.getByRole("button", { name: "INVITE" });
    expect(invite).toBeEnabled();

    fireEvent.click(invite);
    await waitFor(() => expect(inviteToParty).toHaveBeenCalledWith("a3"));
  });

  it("INVITE ALL ONLINE invites everyone but the offline, mid-Match included", async () => {
    useFriends.mockReturnValue(hook({ friends: [...FRIENDS, BONK] }));
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "INVITE ALL ONLINE" }));
    // a2 in a Lobby, a3 mid-Match, a7 in the menus — a4 is offline.
    await waitFor(() => expect(inviteToParty.mock.calls.map(([id]) => id)).toEqual(["a2", "a3", "a7"]));
    expect(await screen.findByText("Invited 3.")).toBeInTheDocument();
  });

  it("a refusal says the API's own reason", async () => {
    useFriends.mockReturnValue(hook({ friends: [...FRIENDS, BONK] }));
    inviteToParty.mockRejectedValue(new ApiError("your party is full", 409));
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "INVITE" }));
    expect(await screen.findByText("your party is full")).toBeInTheDocument();
  });

  it("inside a Lobby they stay Lobby invites, and mid-Match stays uninvitable", async () => {
    const fns = hook({ friends: [...FRIENDS, BONK] });
    useFriends.mockReturnValue(fns);
    renderAt(IN_LOBBY);

    fireEvent.click(screen.getByRole("button", { name: "INVITE" }));
    await waitFor(() => expect(fns.invite).toHaveBeenCalledWith("a7", IN_LOBBY.state.lobbyRef));
    expect(inviteToParty).not.toHaveBeenCalled();
    expect(await screen.findByText("Invite sent.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "IN A MATCH" }));
    expect(screen.getByRole("button", { name: "INVITE" })).toBeDisabled();
  });
});
