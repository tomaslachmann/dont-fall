import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Slider } from "./Slider";

describe("Slider", () => {
  it("renders the current value and aria attributes", () => {
    render(<Slider value={38} onChange={vi.fn()} aria-label="Look sensitivity" />);
    const track = screen.getByRole("slider", { name: "Look sensitivity" });
    expect(track).toHaveAttribute("aria-valuenow", "38");
    expect(screen.getByText("38")).toBeInTheDocument();
  });

  it("increments/decrements by 1 on arrow keys, clamped to min/max", () => {
    const onChange = vi.fn();
    render(<Slider value={0} onChange={onChange} aria-label="Volume" />);
    const track = screen.getByRole("slider", { name: "Volume" });

    fireEvent.keyDown(track, { key: "ArrowLeft" }); // already at min
    expect(onChange).toHaveBeenCalledWith(0);

    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(1);
    fireEvent.keyDown(track, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("can hide the numeric value", () => {
    render(<Slider value={50} onChange={vi.fn()} aria-label="FOV" showValue={false} />);
    expect(screen.queryByText("50")).not.toBeInTheDocument();
  });
});
