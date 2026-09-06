// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { GameCanvas } from "./GameCanvas";

const { startGame } = vi.hoisted(() => ({ startGame: vi.fn() }));
vi.mock("../game.js", () => ({ startGame }));

function renderAtPlayRoute(props: React.ComponentProps<typeof GameCanvas> = {}) {
  return render(
    <MemoryRouter initialEntries={["/play"]}>
      <Routes>
        <Route path="/" element={<div>Main Menu</div>} />
        <Route path="/play" element={<GameCanvas {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GameCanvas", () => {
  it("boots the game once mounted, handing it its own div as the mount", async () => {
    const stop = vi.fn();
    startGame.mockResolvedValueOnce({ stop });

    renderAtPlayRoute({ trackId: "abc123" });

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    const config = startGame.mock.calls[0]![0];
    expect(config.mount).toBeInstanceOf(HTMLElement);
    expect(config.trackId).toBe("abc123");
  });

  it("stops the running game on unmount", async () => {
    const stop = vi.fn();
    startGame.mockResolvedValueOnce({ stop });

    const { unmount } = renderAtPlayRoute();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops the game immediately if unmounted before boot resolves, instead of leaking it", async () => {
    const stop = vi.fn();
    let resolveBoot!: (handle: { stop: () => void }) => void;
    startGame.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBoot = resolve;
      }),
    );

    const { unmount } = renderAtPlayRoute();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    unmount(); // boot is still in flight
    resolveBoot({ stop });
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it("shows a failure message and returns to the menu if the boot rejects", async () => {
    startGame.mockRejectedValueOnce(new Error("server unreachable"));

    renderAtPlayRoute();

    expect(await screen.findByText("server unreachable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to menu" }));
    expect(await screen.findByText("Main Menu")).toBeInTheDocument();
  });

  it("does not forward the exit immediately — the game freezes on its own last frame first", async () => {
    // game.ts's own design: it freezes on the last frame and shows a
    // "reload to rejoin" HUD message when the exit fires, expecting the
    // shell not to react until the player is done reading it. Forwarding
    // onExit immediately would navigate away and tear that down before
    // it's ever seen.
    const onExit = vi.fn();
    startGame.mockImplementationOnce(async (config: { onExit?: (reason: string) => void }) => {
      config.onExit?.("disconnected");
      return { stop: vi.fn() };
    });

    renderAtPlayRoute({ onExit });
    await screen.findByRole("button", { name: "Back to menu" });
    expect(onExit).not.toHaveBeenCalled();
  });

  it("forwards the game's own onExit reason to the caller once the player clicks Back to menu", async () => {
    const onExit = vi.fn();
    startGame.mockImplementationOnce(async (config: { onExit?: (reason: string) => void }) => {
      config.onExit?.("disconnected");
      return { stop: vi.fn() };
    });

    renderAtPlayRoute({ onExit });
    fireEvent.click(await screen.findByRole("button", { name: "Back to menu" }));
    expect(onExit).toHaveBeenCalledWith("disconnected");
  });

  it("does not reboot the game when only the onExit/onMatchEnd identity changes", async () => {
    const stop = vi.fn();
    startGame.mockResolvedValue({ stop });

    const { rerender } = renderAtPlayRoute({ trackId: "abc123", onExit: () => {} });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter initialEntries={["/play"]}>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route path="/play" element={<GameCanvas trackId="abc123" onExit={() => {}} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it("shows the Lobby overlay once the game reports it's in LOBBY, and hides it once the phase moves on", async () => {
    // This Player is the host — LobbyScreen's own effect fetches
    // track-service's Track list on mount, which needs stubbing here too.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) }));
    let reportLobby!: (state: unknown) => void;
    startGame.mockImplementationOnce(async (config: { onLobbyState?: (state: unknown) => void }) => {
      reportLobby = config.onLobbyState!;
      return { stop: vi.fn(), setNickname: vi.fn(), setReady: vi.fn(), selectTrack: vi.fn(), start: vi.fn() };
    });

    renderAtPlayRoute();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    reportLobby({
      myId: "me",
      phase: "LOBBY",
      hostId: "me",
      players: [{ id: "me", nickname: "Player", ready: false, joinOrder: 0 }],
      trackId: "t1",
      trackRevision: 1,
      timeLimitMs: 180_000,
    });
    expect(await screen.findByText("Lobby")).toBeInTheDocument();

    reportLobby({
      myId: "me",
      phase: "COUNTDOWN",
      hostId: "me",
      players: [{ id: "me", nickname: "Player", ready: true, joinOrder: 0 }],
      trackId: "t1",
      trackRevision: 1,
      timeLimitMs: 180_000,
    });
    await waitFor(() => expect(screen.queryByText("Lobby")).not.toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it("shows the Results overlay once the game reports it's in RESULTS, and hides it once back in the Lobby", async () => {
    let reportLobby!: (state: unknown) => void;
    let reportResults!: (rows: unknown) => void;
    startGame.mockImplementationOnce(
      async (config: { onLobbyState?: (state: unknown) => void; onResults?: (rows: unknown) => void }) => {
        reportLobby = config.onLobbyState!;
        reportResults = config.onResults!;
        return {
          stop: vi.fn(),
          setNickname: vi.fn(),
          setReady: vi.fn(),
          selectTrack: vi.fn(),
          start: vi.fn(),
          returnToLobby: vi.fn(),
        };
      },
    );

    renderAtPlayRoute();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    reportLobby({
      myId: "me",
      phase: "RESULTS",
      hostId: "me",
      players: [{ id: "me", nickname: "Player", ready: true, joinOrder: 0 }],
      trackId: "t1",
      trackRevision: 1,
      timeLimitMs: 180_000,
    });
    reportResults([{ id: "me", nickname: "Player", qualified: true, placement: 1, checkpointIndex: 4, fallCount: 0, dnf: false }]);
    expect(await screen.findByText("Results")).toBeInTheDocument();

    reportLobby({
      myId: "me",
      phase: "LOBBY",
      hostId: "me",
      players: [{ id: "me", nickname: "Player", ready: false, joinOrder: 0 }],
      trackId: "t1",
      trackRevision: 1,
      timeLimitMs: 180_000,
    });
    await waitFor(() => expect(screen.queryByText("Results")).not.toBeInTheDocument());
  });

  it("tears down the old game and boots a new one when trackId changes", async () => {
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    startGame.mockResolvedValueOnce({ stop: stopFirst }).mockResolvedValueOnce({ stop: stopSecond });

    const { rerender } = renderAtPlayRoute({ trackId: "abc123" });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter initialEntries={["/play"]}>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route path="/play" element={<GameCanvas trackId="def456" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(2));
    expect(stopFirst).toHaveBeenCalledOnce();
  });
});
