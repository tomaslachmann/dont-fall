import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FLASH_TTL_MS, clearFlashes, flash } from "../lib/flash.js";
import FlashHost from "./FlashHost";

describe("FlashHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearFlashes();
  });

  afterEach(() => {
    clearFlashes();
    vi.useRealTimers();
  });

  it("renders nothing with no flashes", () => {
    const { container } = render(<FlashHost />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a success flash with its DONE kicker, as a status", () => {
    render(<FlashHost />);
    act(() => {
      flash("Invite sent.");
    });

    expect(screen.getByText("DONE")).toBeInTheDocument();
    expect(screen.getByText("Invite sent.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an info flash under HEADS UP, and an error under HOLD ON as an alert", () => {
    render(<FlashHost />);
    act(() => {
      flash("Nobody online to invite.", "info");
      flash("Could not join that Lobby.", "error");
    });

    expect(screen.getByText("HEADS UP")).toBeInTheDocument();
    expect(screen.getByText("HOLD ON")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not join that Lobby.");
  });

  it("dismisses a flash off its button", () => {
    render(<FlashHost />);
    act(() => {
      flash("Invite sent.");
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Invite sent.")).not.toBeInTheDocument();
  });

  it("a success flash leaves on its own after the TTL; an error waits", () => {
    render(<FlashHost />);
    act(() => {
      flash("Invite sent.");
      flash("Could not join that Lobby.", "error");
    });

    act(() => {
      vi.advanceTimersByTime(FLASH_TTL_MS);
    });

    expect(screen.queryByText("Invite sent.")).not.toBeInTheDocument();
    expect(screen.getByText("Could not join that Lobby.")).toBeInTheDocument();
  });
});
