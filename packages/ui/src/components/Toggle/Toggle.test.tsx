import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("shows the off label when unchecked and the on label when checked", () => {
    const { rerender } = render(<Toggle checked={false} />);
    expect(screen.getByText("ready?")).toBeInTheDocument();

    rerender(<Toggle checked />);
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("calls onChange with the flipped value on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles on Space and Enter", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    const el = screen.getByRole("switch");
    fireEvent.keyDown(el, { key: " " });
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("ignores clicks and keypresses when readOnly", () => {
    const onChange = vi.fn();
    render(<Toggle checked readOnly onChange={onChange} />);
    const el = screen.getByRole("switch");
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: " " });
    expect(onChange).not.toHaveBeenCalled();
    expect(el).toHaveAttribute("aria-readonly", "true");
    expect(el).toHaveAttribute("tabindex", "-1");
  });

  it("reflects checked state via aria-checked", () => {
    const { rerender } = render(<Toggle checked={false} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    rerender(<Toggle checked />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});
