// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { LobbyConnection, LobbySnapshot } from "../socket/lobbyConnection.js";
import { useLobbyConnection } from "./useLobbyConnection.js";

const { createLobbyConnection } = vi.hoisted(() => ({ createLobbyConnection: vi.fn() }));
vi.mock("../socket/lobbyConnection.js", () => ({ createLobbyConnection }));

const lobby = (phase: LobbySnapshot["phase"] = "LOBBY"): LobbySnapshot =>
  ({
    myId: "me",
  matchId: "match-1",
    phase,
    matchOver: null,
    hostId: "me",
    players: [{ id: "me", nickname: "Player", ready: false, joinOrder: 0, accountId: null, bodySkin: null }],
    trackId: "t1",
    trackRevision: 1,
    timeLimitMs: 180_000,
    roundType: "race",
    survivorTarget: 1,
    startBlockedReason: undefined,
    countdownMsLeft: 0,
    matchLength: 1,
    roundPicks: [],
    maxPlayers: 4,
  }) as LobbySnapshot;

const fakeConnection = (): LobbyConnection & {
  lobbyListeners: Set<(lobby: LobbySnapshot) => void>;
  closeListeners: Set<() => void>;
} => {
  const lobbyListeners = new Set<(lobby: LobbySnapshot) => void>();
  const closeListeners = new Set<() => void>();
  return {
    socket: {} as WebSocket,
    welcome: {} as LobbyConnection["welcome"],
    myId: "me",
    getLobby: () => null,
    subscribeLobby: (listener) => {
      lobbyListeners.add(listener);
      return () => {
        lobbyListeners.delete(listener);
      };
    },
    onClose: (listener) => {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    close: vi.fn(),
    setNickname: vi.fn(),
    setReady: vi.fn(),
    selectTrack: vi.fn(),
    setRoundType: vi.fn(),
    setMatchLength: vi.fn(),
    pickRoundSlot: vi.fn(),
    start: vi.fn(),
    standingsReady: vi.fn(),
    lobbyListeners,
    closeListeners,
  };
};

describe("useLobbyConnection", () => {
  it("connects on mount and publishes Lobby snapshots as state", async () => {
    const connection = fakeConnection();
    createLobbyConnection.mockResolvedValueOnce(connection);

    const { result } = renderHook(() => useLobbyConnection(51234));

    expect(result.current.connection).toBeNull();
    expect(result.current.lobby).toBeNull();
    await waitFor(() => expect(result.current.connection).toBe(connection));

    act(() => {
      for (const listener of connection.lobbyListeners) listener(lobby());
    });
    expect(result.current.lobby?.phase).toBe("LOBBY");
  });

  it("delegates actions to the current connection through a stable identity", async () => {
    const connection = fakeConnection();
    createLobbyConnection.mockResolvedValueOnce(connection);

    const { result } = renderHook(() => useLobbyConnection(51234));
    const firstActions = result.current.actions;
    await waitFor(() => expect(result.current.connection).toBe(connection));

    // Actions sent before any snapshot still reach the socket — the Screen
    // renders them only once a Lobby exists, but the hook promises nothing
    // about timing, only about delivery.
    result.current.actions.setReady(true);
    result.current.actions.start();
    expect(connection.setReady).toHaveBeenCalledWith(true);
    expect(connection.start).toHaveBeenCalledOnce();
    expect(result.current.actions).toBe(firstActions);
  });

  it("reports a failed connect as an error instead of hanging on loading", async () => {
    createLobbyConnection.mockRejectedValueOnce(new Error("server unreachable"));

    const { result } = renderHook(() => useLobbyConnection(51234));

    await waitFor(() => expect(result.current.error?.message).toBe("server unreachable"));
    expect(result.current.connection).toBeNull();
  });

  it("reports a dropped socket and closes it on unmount", async () => {
    const connection = fakeConnection();
    createLobbyConnection.mockResolvedValueOnce(connection);

    const { result, unmount } = renderHook(() => useLobbyConnection(51234));
    await waitFor(() => expect(result.current.connection).toBe(connection));

    act(() => {
      for (const listener of connection.closeListeners) listener();
    });
    expect(result.current.closed).toBe(true);

    unmount();
    expect(connection.close).toHaveBeenCalled();
  });
});
