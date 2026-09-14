// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router";
import type { FriendRequestView, FriendView, RecentPlayerView } from "@dont-fall/shared";
import { FriendsRoute } from "./FriendsRoute";

const { useFriends } = vi.hoisted(() => ({ useFriends: vi.fn() }));
vi.mock("../lib/hooks/useFriends.js", () => ({ useFriends }));

const { resolveLobbyRef } = vi.hoisted(() => ({ resolveLobbyRef: vi.fn() }));
vi.mock("../lib/api/lobbyBroker.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveLobbyRef,
}));

const FRIENDS: FriendView[] = [
  {
    accountId: "a2",
    displayName: "Floppo",
    avatarUrl: null,
    friendsSince: 1,
    presence: { status: "in-lobby", slotsOpen: 3, joinable: true, lobby: { kind: "public", lobbyId: "l1" } },
  },
  {
    accountId: "a3",
    displayName: "Wobbleton",
    avatarUrl: null,
    friendsSince: 2,
    presence: { status: "in-match", round: 2 },
  },
  {
    accountId: "a4",
    displayName: "Tumbleweed",
    avatarUrl: null,
    friendsSince: 3,
    presence: { status: "offline", lastSeenAt: Date.now() - 2 * 86_400_000 },
  },
];

const REQUESTS: FriendRequestView[] = [
  { id: "r1", fromAccountId: "a5", fromDisplayName: "Goopy", fromAvatarUrl: null, sentAt: 1, matchesTogether: 4 },
];

const RECENT: RecentPlayerView[] = [
  { accountId: "a6", displayName: "Splatteo", avatarUrl: null, matchesTogether: 2, lastPlayedAt: Date.now() - 3_600_000 },
];

const hook = (overrides = {}) => ({
  friends: FRIENDS,
  online: 1,
  total: 3,
  requests: REQUESTS,
  recent: RECENT,
  code: "BEAN42",
  invites: [],
  dismissInvite: vi.fn(),
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

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/friends" element={<FriendsRoute />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/lobby" element={<LobbyProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe("FriendsRoute", () => {
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

  it("accept/decline answer the request; JOIN resolves the ref and lands in the Lobby", async () => {
    const fns = hook();
    useFriends.mockReturnValue(fns);
    resolveLobbyRef.mockResolvedValue({ id: "l1", port: 61000 });
    renderAt("/friends");

    fireEvent.click(screen.getByRole("button", { name: "Accept Goopy" }));
    expect(fns.acceptRequest).toHaveBeenCalledWith("r1");

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
