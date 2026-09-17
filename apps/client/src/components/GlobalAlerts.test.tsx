// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router";
import GlobalAlerts from "./GlobalAlerts";
import { clearFlashes } from "../lib/flash.js";
import { setGameActive } from "../lib/gamePresence.js";

const { useFriends } = vi.hoisted(() => ({ useFriends: vi.fn() }));
vi.mock("../lib/hooks/useFriends.js", () => ({ useFriends }));

const { resolveLobbyRef } = vi.hoisted(() => ({ resolveLobbyRef: vi.fn() }));
vi.mock("../lib/api/lobbyBroker.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveLobbyRef,
}));

const REQUEST = {
  id: "r1",
  fromAccountId: "a5",
  fromDisplayName: "Goopy",
  fromAvatarUrl: null,
  sentAt: 1,
  matchesTogether: 4,
};

const INVITE = {
  id: "i1",
  fromAccountId: "a2",
  fromDisplayName: "Floppo",
  lobby: { kind: "public", lobbyId: "l1" } as const,
  sentAt: 1,
};

const hook = (overrides = {}) => ({
  friends: [],
  online: 0,
  total: 0,
  requests: [REQUEST],
  recent: [],
  code: null,
  invites: [INVITE],
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

describe("GlobalAlerts", () => {
  beforeEach(() => {
    clearFlashes();
    setGameActive(false);
  });

  afterEach(() => {
    clearFlashes();
    setGameActive(false);
  });

  it("shows friend requests and Lobby invites on a menu route", () => {
    useFriends.mockReturnValue(hook());
    renderAt("/");

    expect(screen.getByText("GOOPY WANTS IN")).toBeInTheDocument();
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });

  it("the invite survives navigation — it is global, not one Screen's", () => {
    useFriends.mockReturnValue(hook());
    const { unmount } = renderAt("/");
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
    unmount();

    renderAt("/settings");
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });

  it("on /friends the requests stay inline — only invites overlay", () => {
    useFriends.mockReturnValue(hook());
    renderAt("/friends");

    expect(screen.queryByText("GOOPY WANTS IN")).not.toBeInTheDocument();
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });

  it("JOIN resolves the invite's Lobby and lands in it", async () => {
    const fns = hook();
    useFriends.mockReturnValue(fns);
    resolveLobbyRef.mockResolvedValue({ id: "l1", port: 61000 });
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));

    // The invite dismisses only once the Lobby resolves, then lands in it.
    expect(await screen.findByText("lobby:61000|null")).toBeInTheDocument();
    expect(fns.dismissInvite).toHaveBeenCalledWith("i1");
  });

  it("a failed JOIN stays put and flashes why — and the invite stays up", async () => {
    const fns = hook();
    useFriends.mockReturnValue(fns);
    resolveLobbyRef.mockRejectedValue(new Error("that Lobby is no longer joinable"));
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));

    expect(await screen.findByText("that Lobby is no longer joinable")).toBeInTheDocument();
    expect(screen.getByText("HOLD ON")).toBeInTheDocument();
    // No game started and nothing was answered — the invite must survive.
    expect(fns.dismissInvite).not.toHaveBeenCalled();
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
    const fns = hook();
    useFriends.mockReturnValue(fns);
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss invite from Floppo" }));

    expect(fns.dismissInvite).toHaveBeenCalledWith("i1");
    expect(screen.queryByText(/lobby:/)).not.toBeInTheDocument();
  });

  it("hides the social alerts while a game owns the screen — flashes still show", async () => {
    useFriends.mockReturnValue(hook());
    renderAt("/");
    expect(screen.getByText("FLOPPO INVITED YOU")).toBeInTheDocument();

    // A failed JOIN's error flash must survive the game starting underneath.
    resolveLobbyRef.mockRejectedValue(new Error("that Lobby is no longer joinable"));
    fireEvent.click(screen.getByRole("button", { name: "JOIN" }));
    expect(await screen.findByText("that Lobby is no longer joinable")).toBeInTheDocument();

    setGameActive(true);
    await waitFor(() => expect(screen.queryByText("FLOPPO INVITED YOU")).not.toBeInTheDocument());
    expect(screen.queryByText("GOOPY WANTS IN")).not.toBeInTheDocument();
    expect(screen.getByText("that Lobby is no longer joinable")).toBeInTheDocument();

    setGameActive(false);
    expect(await screen.findByText("FLOPPO INVITED YOU")).toBeInTheDocument();
  });
});
