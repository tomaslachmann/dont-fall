// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LobbySnapshot } from "../game/index.js";
import { LobbyScreen } from "./LobbyScreen";

// The host row's own effect fetches track-service's Track list on mount —
// stubbed by default so tests that don't care about it never hit a real
// (nonexistent, in this test environment) network address.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const baseLobby = (overrides: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  myId: "host-id",
  phase: "LOBBY",
  hostId: "host-id",
  players: [
    { id: "host-id", nickname: "Host Player", ready: false, joinOrder: 0 },
    { id: "guest-id", nickname: "Guest", ready: true, joinOrder: 1 },
  ],
  trackId: "track-a",
  trackRevision: 1,
  timeLimitMs: 180_000,
  roundType: "race",
  survivorTarget: 1,
  startBlockedReason: undefined,
  ...overrides,
});

const noop = () => {};

describe("LobbyScreen", () => {
  it("lists every connected Player, marking the host row", () => {
    render(
      <LobbyScreen lobby={baseLobby()} onSetNickname={noop} onSetReady={noop} onSelectTrack={noop} onSetRoundType={noop} onStart={noop} />,
    );

    expect(screen.getByText("Host Player")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("HOST")).toBeInTheDocument();
  });

  it("lets this Player toggle their own Ready state, but not another Player's", () => {
    const onSetReady = vi.fn();
    render(
      <LobbyScreen
        lobby={baseLobby()}
        onSetNickname={noop}
        onSetReady={onSetReady}
        onSelectTrack={noop}
        onSetRoundType={noop}
        onStart={noop}
      />,
    );

    const switches = screen.getAllByRole("switch");
    // Host (this Player, not ready) is interactive; Guest's is read-only.
    fireEvent.click(switches[0]!);
    expect(onSetReady).toHaveBeenCalledWith(true);

    onSetReady.mockClear();
    fireEvent.click(switches[1]!);
    expect(onSetReady).not.toHaveBeenCalled();
  });

  it("sends the trimmed nickname once the input loses focus", () => {
    const onSetNickname = vi.fn();
    render(
      <LobbyScreen
        lobby={baseLobby()}
        onSetNickname={onSetNickname}
        onSetReady={noop}
        onSelectTrack={noop}
        onSetRoundType={noop}
        onStart={noop}
      />,
    );

    const input = screen.getByDisplayValue("Host Player");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.blur(input);
    expect(onSetNickname).toHaveBeenCalledWith("New Name");
  });

  it("disables Start until everyone connected is Ready, for the host", () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <LobbyScreen lobby={baseLobby()} onSetNickname={noop} onSetReady={noop} onSelectTrack={noop} onSetRoundType={noop} onStart={onStart} />,
    );

    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();

    rerender(
      <LobbyScreen
        lobby={baseLobby({
          players: [
            { id: "host-id", nickname: "Host Player", ready: true, joinOrder: 0 },
            { id: "guest-id", nickname: "Guest", ready: true, joinOrder: 1 },
          ],
        })}
        onSetNickname={noop}
        onSetReady={noop}
        onSelectTrack={noop}
        onSetRoundType={noop}
        onStart={onStart}
      />,
    );

    const startButton = screen.getByRole("button", { name: "Start" });
    expect(startButton).not.toBeDisabled();
    fireEvent.click(startButton);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows a Track picker only to the host, fetched from track-service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve([{ id: "track-a", name: "Wobble Ramp" }, { id: "track-b", name: null }]),
      }),
    );

    const onSelectTrack = vi.fn();
    render(
      <LobbyScreen
        lobby={baseLobby()}
        onSetNickname={noop}
        onSetReady={noop}
        onSelectTrack={onSelectTrack}
        onSetRoundType={noop}
        onStart={noop}
      />,
    );

    expect(await screen.findByText("Wobble Ramp")).toBeInTheDocument();
    expect(screen.getByText("track-b")).toBeInTheDocument();
    fireEvent.click(screen.getByText("track-b"));
    expect(onSelectTrack).toHaveBeenCalledWith("track-b");
  });

  it("does not fetch the Track list, or offer a picker, for a non-host Player", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock); // overrides the beforeEach default — this test asserts it's never called

    render(
      <LobbyScreen
        lobby={baseLobby({ myId: "guest-id" })}
        onSetNickname={noop}
        onSetReady={noop}
        onSelectTrack={noop}
        onSetRoundType={noop}
        onStart={noop}
      />,
    );

    expect(screen.getByText("Only the host picks the Track.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the host to start…")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  describe("the Round type (M5 ticket 07)", () => {
    it("shows the picked Round type to every Player, host or not", () => {
      render(
        <LobbyScreen
          lobby={baseLobby({ myId: "guest-id", roundType: "survival" })}
          onSetNickname={noop}
          onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={noop}
          onStart={noop}
        />,
      );

      expect(screen.getByRole("button", { name: "Survival" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Race" })).toHaveAttribute("aria-pressed", "false");
    });

    it("lets the host pick one, and nobody else", () => {
      const onSetRoundType = vi.fn();
      const { rerender } = render(
        <LobbyScreen
          lobby={baseLobby()}
          onSetNickname={noop}
          onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={onSetRoundType}
          onStart={noop}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Survival" }));
      expect(onSetRoundType).toHaveBeenCalledWith("survival");

      rerender(
        <LobbyScreen
          lobby={baseLobby({ myId: "guest-id" })}
          onSetNickname={noop}
          onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={onSetRoundType}
          onStart={noop}
        />,
      );

      expect(screen.getByRole("button", { name: "Survival" })).toBeDisabled();
    });

    it("shows the Survivor Target for Survival, and never for a Race", () => {
      const { rerender } = render(
        <LobbyScreen
          lobby={baseLobby({ roundType: "survival", survivorTarget: 4 })}
          onSetNickname={noop}
          onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={noop}
          onStart={noop}
        />,
      );

      expect(screen.getByText(/last 4 Players standing/)).toBeInTheDocument();

      rerender(
        <LobbyScreen
          lobby={baseLobby({ roundType: "race", survivorTarget: 4 })}
          onSetNickname={noop}
          onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={noop}
          onStart={noop}
        />,
      );

      expect(screen.queryByText(/standing/)).not.toBeInTheDocument();
    });

    it("shows the server's reason a Round can't start, and disables Start with it", () => {
      const onStart = vi.fn();
      const readyPlayers = [
        { id: "host-id", nickname: "Host Player", ready: true, joinOrder: 0 },
        { id: "guest-id", nickname: "Guest", ready: true, joinOrder: 1 },
      ];
      render(
        <LobbyScreen
          lobby={baseLobby({ players: readyPlayers, startBlockedReason: "This Track has no Finish Zone." })}
          onSetNickname={noop}
          onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={noop}
          onStart={onStart}
        />,
      );

      expect(screen.getByText("This Track has no Finish Zone.")).toBeInTheDocument();
      // Everyone is Ready — the only thing holding this Lobby is the Track.
      expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    });

    it("shows the reason to a non-host too, so the wait doesn't look like the host not clicking", () => {
      render(
        <LobbyScreen
          lobby={baseLobby({ myId: "guest-id", startBlockedReason: "This Track has no Finish Zone." })}
          onSetNickname={noop}
          onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={noop}
          onStart={noop}
        />,
      );

      expect(screen.getByText("This Track has no Finish Zone.")).toBeInTheDocument();
    });
  });
});
