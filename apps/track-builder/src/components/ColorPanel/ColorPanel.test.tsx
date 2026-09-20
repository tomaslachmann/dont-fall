import { act, fireEvent, render, screen } from "@testing-library/react";
import { SEGMENT_COLORS } from "@dont-fall/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createBuilderEngine } from "../../engine.js";
import { ColorPanel } from "./ColorPanel";

describe("ColorPanel", () => {
  beforeEach(() => {
    // Section open state persists across reloads (and tests) — every test opens its own.
    localStorage.clear();
  });

  it("offers the 8 hues as striped swatches and paints through the engine", () => {
    const engine = createBuilderEngine();
    engine.placeModule("kaykit_platform_6x6x1_red");
    render(<ColorPanel engine={engine} />);
    fireEvent.click(screen.getByRole("button", { name: /^COLOR/ }));

    const swatches = screen.getAllByRole("button", { name: /^paint / });
    expect(swatches).toHaveLength(SEGMENT_COLORS.length);
    // Striped like Character Select's COLOR tab, from the aimed hue itself.
    expect(swatches[0]!.getAttribute("style")).toMatch(/repeating-linear-gradient\(45deg.*hsl\(0,/);

    fireEvent.click(screen.getByRole("button", { name: "paint blue" }));
    expect(engine.track[0]!.color).toBe("blue");
    expect(screen.getByRole("button", { name: "paint blue" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the hint — never the grid — for lone looks and empty selection", () => {
    const engine = createBuilderEngine();
    render(<ColorPanel engine={engine} />);
    fireEvent.click(screen.getByRole("button", { name: /^COLOR/ }));
    expect(screen.getByText("Select a Segment to repaint its colored parts.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^paint / })).toBeNull();

    act(() => {
      engine.placeModule("kaykit_ball");
    });
    expect(screen.getByText("Only color families repaint — this Asset keeps its authored look.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^paint / })).toBeNull();
  });
});
