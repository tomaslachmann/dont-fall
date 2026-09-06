// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "./App";

const { startGame } = vi.hoisted(() => ({ startGame: vi.fn() }));
vi.mock("./game.js", () => ({ startGame }));

describe("App", () => {
  it("opens on the Main Menu, not straight into a running game", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("Don't Fall")).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("boots the game only once Play is clicked, and returns to the menu once the player leaves after an exit", async () => {
    const stop = vi.fn();
    let exitFromGame!: (reason: "disconnected") => void;
    startGame.mockImplementation(async (config: { onExit?: (reason: "disconnected") => void }) => {
      exitFromGame = config.onExit!;
      return { stop };
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.queryByText("Don't Fall")).not.toBeInTheDocument();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    // The game reports an exit (e.g. a lost connection) but freezes on its
    // own last frame first — the shell only navigates once the player
    // actually clicks through, not the instant the game reports it.
    exitFromGame("disconnected");
    expect(screen.queryByText("Don't Fall")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Back to menu" }));
    expect(await screen.findByText("Don't Fall")).toBeInTheDocument();
  });

  it("passes a `?track=` on /play through to the game — Track Builder's own Playtest link", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/play?track=abc123"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    expect(startGame.mock.calls[0]![0].trackId).toBe("abc123");
  });

  it("connects to whatever the server chose when /play has no `?track=`", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/play"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    expect(startGame.mock.calls[0]![0].trackId).toBeUndefined();
  });
});
