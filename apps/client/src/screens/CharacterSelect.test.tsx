// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CharacterSelect from "./CharacterSelect";

const renderScreen = (props: Partial<React.ComponentProps<typeof CharacterSelect>> = {}) =>
  render(<CharacterSelect selected={0} {...props} />);

describe("CharacterSelect", () => {
  it("tabs switch the cosmetic category — local UI state, no backend", () => {
    renderScreen();

    expect(screen.getByRole("tab", { name: "BODY" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "PATTERN" }));
    expect(screen.getByRole("tab", { name: "PATTERN" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "BODY" })).toHaveAttribute("aria-selected", "false");
  });

  it("the pick is controlled — swatches report up, the Route owns the state", () => {
    const onSelect = vi.fn();
    renderScreen({ selected: 2, onSelect });

    const skins = screen.getAllByRole("button", { name: /(Skin \d+|Base)/ });
    expect(skins).toHaveLength(8);
    expect(skins[2]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(skins[5]!);
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it("lock tiles are decoration, not buttons — nothing to press until that content exists", () => {
    renderScreen();

    expect(screen.getByText("LV 45")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /LV 45/ })).toBeNull();
  });

  it("ROTATE and PLAY EMOTE fire without a renderer — jsdom shows the fallback caption", () => {
    renderScreen();

    expect(screen.getByText(/LIVE 3D CHARACTER RENDER/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ROTATE" }));
    fireEvent.click(screen.getByRole("button", { name: "ROTATE" }));
    fireEvent.click(screen.getByRole("button", { name: "PLAY EMOTE" }));
    expect(screen.getByText(/LIVE 3D CHARACTER RENDER/)).toBeInTheDocument();
  });

  it("RANDOMISE reports a different skin — never a dead re-roll of the current pick", () => {
    const onSelect = vi.fn();
    renderScreen({ selected: 2, onSelect });

    fireEvent.click(screen.getByRole("button", { name: "RANDOMISE" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [next] = onSelect.mock.calls[0]!;
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(8);
    expect(next).not.toBe(2);
  });

  it("the last swatch is the factory base — picked like any skin, id 7", () => {
    const onSelect = vi.fn();
    renderScreen({ selected: 7, onSelect });

    expect(screen.getByRole("button", { name: "Base" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Skin 1" }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("the notice renders inline under the equipped row — alert for errors, status for info", () => {
    const { rerender } = renderScreen();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<CharacterSelect selected={0} notice={{ text: "Couldn't save your bean: boom", tone: "error" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save your bean: boom");

    rerender(<CharacterSelect selected={0} notice={{ text: "The shop isn't here yet.", tone: "info" }} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("The shop isn't here yet.");
  });

  it("back, save and shop fire their callbacks — the Route decides what they do", () => {
    const onBack = vi.fn();
    const onSave = vi.fn();
    const onShop = vi.fn();
    renderScreen({ onBack, onSave, onShop });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    fireEvent.click(screen.getByRole("button", { name: "OPEN SHOP" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onShop).toHaveBeenCalledTimes(1);
  });
});
