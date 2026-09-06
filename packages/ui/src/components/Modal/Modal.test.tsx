import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} aria-label="Browse tracks">
        content
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders its content when open", () => {
    render(
      <Modal open onClose={vi.fn()} aria-label="Browse tracks">
        <p>Wobble Canyon</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Browse tracks" })).toBeInTheDocument();
    expect(screen.getByText("Wobble Canyon")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} aria-label="Browse tracks">
        content
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on backdrop click but not on dialog content click", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} aria-label="Browse tracks">
        <p>content</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText("content"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
