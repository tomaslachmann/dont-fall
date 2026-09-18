// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CharacterSelect from "./CharacterSelect";

const renderScreen = (props: Partial<React.ComponentProps<typeof CharacterSelect>> = {}) =>
  render(<CharacterSelect color={0} {...props} />);

describe("CharacterSelect", () => {
  it("tabs switch the cosmetic category — local UI state, no backend", () => {
    renderScreen();

    expect(screen.getByRole("tab", { name: "COLOR" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "SKIN" }));
    expect(screen.getByRole("tab", { name: "SKIN" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "COLOR" })).toHaveAttribute("aria-selected", "false");
  });

  it("the color pick is controlled — swatches report up, the Route owns the state", () => {
    const onSelectColor = vi.fn();
    renderScreen({ color: 2, onSelectColor });

    const colors = screen.getAllByRole("button", { name: /(Colour \d+|Base)/ });
    expect(colors).toHaveLength(8);
    expect(colors[2]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(colors[5]!);
    expect(onSelectColor).toHaveBeenCalledWith(5);
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

  it("RANDOMISE reports a different color — never a dead re-roll of the current pick", () => {
    const onSelectColor = vi.fn();
    renderScreen({ color: 2, onSelectColor });

    fireEvent.click(screen.getByRole("button", { name: "RANDOMISE" }));
    expect(onSelectColor).toHaveBeenCalledTimes(1);
    const [next] = onSelectColor.mock.calls[0]!;
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(8);
    expect(next).not.toBe(2);
  });

  it("the last swatch is the factory base — picked like any color, id 7", () => {
    const onSelectColor = vi.fn();
    renderScreen({ color: 7, onSelectColor });

    expect(screen.getByRole("button", { name: "Base" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Colour 1" }));
    expect(onSelectColor).toHaveBeenCalledWith(0);
  });

  it("carries no notice line of its own — confirmations and failures are global flashes", () => {
    renderScreen();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
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

  describe("the HAT tab (ADR 0083)", () => {
    const openHats = (props: Partial<React.ComponentProps<typeof CharacterSelect>> = {}) => {
      renderScreen(props);
      fireEvent.click(screen.getByRole("tab", { name: "HAT" }));
    };

    it("offers no hat and every hat the level has unlocked, and shows the rest locked with their level", () => {
      openHats({ level: 9 });

      expect(screen.getByRole("button", { name: "No hat" })).toBeInTheDocument();
      for (const name of ["TRAFFIC CONE", "POT", "BUCKET"]) {
        expect(screen.getByRole("button", { name })).toBeInTheDocument();
      }
      for (const name of ["PROPELLER CAP", "CROWN", "UFO"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(screen.getByText("LV 14")).toBeInTheDocument();
      expect(screen.getByText("LV 20")).toBeInTheDocument();
      expect(screen.getByText("LV 30")).toBeInTheDocument();
      // The colors are the COLOR tab's, not this one's.
      expect(screen.queryByRole("button", { name: "Colour 1" })).toBeNull();
    });

    it("a fresh Account (level 1) can only go bareheaded", () => {
      openHats();

      expect(screen.getByRole("button", { name: "No hat" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByRole("button", { name: "TRAFFIC CONE" })).toBeNull();
      expect(screen.getByText("LV 2")).toBeInTheDocument();
    });

    it("the hat pick is controlled — tiles report up, the pressed one is the Route's", () => {
      const onSelectHat = vi.fn();
      openHats({ level: 30, hat: "crown", onSelectHat });

      expect(screen.getByRole("button", { name: "CROWN" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "No hat" })).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(screen.getByRole("button", { name: "UFO" }));
      expect(onSelectHat).toHaveBeenCalledWith("ufo");
      fireEvent.click(screen.getByRole("button", { name: "No hat" }));
      expect(onSelectHat).toHaveBeenLastCalledWith(null);
    });
  });

  describe("the SKIN tab (ADR 0091)", () => {
    const openSkins = (props: Partial<React.ComponentProps<typeof CharacterSelect>> = {}) => {
      renderScreen(props);
      fireEvent.click(screen.getByRole("tab", { name: "SKIN" }));
    };

    it("offers no skin and every skin the level has unlocked, and shows the rest locked with their level", () => {
      openSkins({ level: 6 });

      expect(screen.getByRole("button", { name: "No skin" })).toBeInTheDocument();
      for (const name of ["STARTER CREAM", "ZEBRA", "MINT SPOTS", "TIGER"]) {
        expect(screen.getByRole("button", { name })).toBeInTheDocument();
      }
      for (const name of ["SUNSET STRIPES", "COW", "GALAXY", "FROG"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(screen.getByText("LV 24")).toBeInTheDocument();
      // The colors are the COLOR tab's, not this one's.
      expect(screen.queryByRole("button", { name: "Colour 1" })).toBeNull();
    });

    it("a fresh Account (level 1) gets the starter and nothing else", () => {
      openSkins();

      expect(screen.getByRole("button", { name: "STARTER CREAM" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "ZEBRA" })).toBeNull();
      expect(screen.getByText("LV 3")).toBeInTheDocument();
    });

    it("the skin pick is controlled — tiles report up, the pressed one is the Route's", () => {
      const onSelectSkin = vi.fn();
      openSkins({ level: 24, skin: "tiger", onSelectSkin });

      expect(screen.getByRole("button", { name: "TIGER" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "No skin" })).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(screen.getByRole("button", { name: "FROG" }));
      expect(onSelectSkin).toHaveBeenCalledWith("frog");
      fireEvent.click(screen.getByRole("button", { name: "No skin" }));
      expect(onSelectSkin).toHaveBeenLastCalledWith(null);
    });

    it("RANDOMISE on this tab re-rolls the skin, never the color, and only among what is unlocked", () => {
      const onSelectSkin = vi.fn();
      const onSelectColor = vi.fn();
      openSkins({ level: 6, skin: "tiger", onSelectSkin, onSelectColor });

      fireEvent.click(screen.getByRole("button", { name: "RANDOMISE" }));

      expect(onSelectColor).not.toHaveBeenCalled();
      expect(onSelectSkin).toHaveBeenCalledTimes(1);
      const [next] = onSelectSkin.mock.calls[0]!;
      expect(["starter-cream", "zebra", "mint-spots"]).toContain(next);
    });
  });
});
