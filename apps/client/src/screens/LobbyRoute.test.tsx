// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { LobbyConnection, LobbySnapshot } from "../lib/socket/lobbyConnection.js";
import { LobbyRoute } from "./LobbyRoute";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { WithQuery } from "../test/query.js";

const { useLobbyConnection } = vi.hoisted(() => ({ useLobbyConnection: vi.fn() }));
vi.mock("../lib/hooks/useLobbyConnection.js", () => ({ useLobbyConnection }));

const { gameCanvasProps } = vi.hoisted(() => ({ gameCanvasProps: [] as unknown[] }));
vi.mock("../components/GameCanvas.js", () => ({
  GameCanvas: (props: unknown) => {
    gameCanvasProps.push(props);
    return <div>Game canvas</div>;
  },
}));

// The logged-in Account is what names this Player in the roster (ADR 0052).
vi.mock("../lib/hooks/useAccount.js", () => ({
  useAccount: () => ({
    status: "authed",
    account: { id: "a1", discordId: null, email: null, displayName: "Wobbleton", avatarUrl: null, xp: 0, coins: 0 },
    recheck: () => {},
  }),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) }));
  gameCanvasProps.length = 0;
  useLobbyConnection.mockClear();
});

const lobby = (phase: LobbySnapshot["phase"]): LobbySnapshot =>
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

const connection = { socket: {}, welcome: { playerId: "me" } } as unknown as LobbyConnection;

const actions = {
  setNickname: vi.fn(),
  setReady: vi.fn(),
  selectTrack: vi.fn(),
  setRoundType: vi.fn(),
  setMatchLength: vi.fn(),
  pickRoundSlot: vi.fn(),
  start: vi.fn(),
  standingsReady: vi.fn(),
};

const renderAtLobby = (entry = "/lobby?port=51234") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<div>Main Menu</div>} />
        <Route path="/play" element={<div>Play select</div>} />
        <Route
          path="/lobby"
          element={
            <ErrorBoundary>
              <WithQuery><LobbyRoute /></WithQuery>
            </ErrorBoundary>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe("LobbyRoute", () => {
  it("sends a port-less visit back to /play — there is no Lobby to connect to", async () => {
    useLobbyConnection.mockReturnValue({ connection: null, lobby: null, actions, error: null, closed: false });

    renderAtLobby("/lobby");

    expect(await screen.findByText("Play select")).toBeInTheDocument();
    expect(useLobbyConnection).not.toHaveBeenCalled();
  });

  it("shows a connecting state before the first snapshot — no game boots for a wait", async () => {
    useLobbyConnection.mockReturnValue({ connection: null, lobby: null, actions, error: null, closed: false });

    renderAtLobby();

    expect(await screen.findByText("Connecting to the Lobby…")).toBeInTheDocument();
    expect(screen.queryByText("Game canvas")).not.toBeInTheDocument();
  });

  it("renders the Lobby Screen on its own once in LOBBY — still no game behind it", async () => {
    useLobbyConnection.mockReturnValue({ connection, lobby: lobby("LOBBY"), actions, error: null, closed: false });

    renderAtLobby();

    expect(await screen.findByText("LOBBY")).toBeInTheDocument();
    expect(screen.queryByText("Game canvas")).not.toBeInTheDocument();
  });

  it("wires the Screen's controls to the connection's actions", async () => {
    const ready = lobby("LOBBY");
    ready.players = [{ id: "me", nickname: "Player", ready: true, joinOrder: 0, accountId: null, bodySkin: null }];
    useLobbyConnection.mockReturnValue({ connection, lobby: ready, actions, error: null, closed: false });

    renderAtLobby();

    // All Ready and unblocked: the host's START MATCH is live and reaches the socket.
    // (Regex: the accessible name carries the kicker — "1 ROUND · 1/1 READY START MATCH".)
    fireEvent.click(await screen.findByRole("button", { name: /START MATCH/ }));
    expect(actions.start).toHaveBeenCalledOnce();
  });

  it("hands the live connection to the game the moment the server leaves LOBBY", async () => {
    useLobbyConnection.mockReturnValue({
      connection,
      lobby: lobby("COUNTDOWN"),
      actions,
      error: null,
      closed: false,
    });

    renderAtLobby();

    expect(await screen.findByText("Game canvas")).toBeInTheDocument();
    expect(gameCanvasProps).toHaveLength(1);
    expect((gameCanvasProps[0] as { connection: unknown }).connection).toBe(connection);
    expect(screen.queryByText("LOBBY")).not.toBeInTheDocument();
  });

  it("reports a failed connect on the connection ErrorScreen, with the real reason", async () => {
    useLobbyConnection.mockReturnValue({
      connection: null,
      lobby: null,
      actions,
      error: new Error("server unreachable"),
      closed: false,
    });

    renderAtLobby();

    expect(await screen.findByText("CONNECTION LOST")).toBeInTheDocument();
    expect(screen.getByText("server unreachable")).toBeInTheDocument();
  });

  it("TRY AGAIN redials the Lobby — a fresh mount is a fresh handshake", async () => {
    useLobbyConnection.mockReturnValue({
      connection: null,
      lobby: null,
      actions,
      error: new Error("server unreachable"),
      closed: false,
    });

    renderAtLobby();
    await screen.findByText("CONNECTION LOST");

    useLobbyConnection.mockReturnValue({ connection, lobby: lobby("LOBBY"), actions, error: null, closed: false });
    const callsBeforeRetry = useLobbyConnection.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));

    // Remounted: the hook ran again and this time the Lobby arrived.
    expect(await screen.findByText("LOBBY")).toBeInTheDocument();
    expect(useLobbyConnection.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it("a dropped socket lands on the same screen, MAIN MENU boots home", async () => {
    useLobbyConnection.mockReturnValue({ connection, lobby: lobby("LOBBY"), actions, error: null, closed: true });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });

    renderAtLobby();

    expect(await screen.findByText("CONNECTION LOST")).toBeInTheDocument();
    expect(screen.getByText("The connection dropped.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "MAIN MENU" }));
    expect(assign).toHaveBeenCalledWith("/");
  });
});
