// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Turntable } from "./Turntable";

describe("Turntable", () => {
  it("degrades to the caption where WebGL doesn't exist — jsdom has no GPU", () => {
    render(<Turntable color={0} skin={null} hat={null} spinToken={0} emoteToken={0} />);

    expect(screen.getByText(/LIVE 3D CHARACTER RENDER/)).toBeInTheDocument();
  });

  it("color, skin, spin and emote changes don't crash the fallback", () => {
    const { rerender } = render(<Turntable color={0} skin={null} hat={null} spinToken={0} emoteToken={0} />);

    rerender(<Turntable color={5} skin="tiger" hat={null} spinToken={1} emoteToken={2} />);
    expect(screen.getByText(/LIVE 3D CHARACTER RENDER/)).toBeInTheDocument();
  });
});
