// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Turntable } from "./Turntable";

describe("Turntable", () => {
  it("degrades to the caption where WebGL doesn't exist — jsdom has no GPU", () => {
    render(<Turntable skin={0} hat={null} spinToken={0} emoteToken={0} />);

    expect(screen.getByText(/LIVE 3D CHARACTER RENDER/)).toBeInTheDocument();
  });

  it("skin, spin and emote changes don't crash the fallback", () => {
    const { rerender } = render(<Turntable skin={0} hat={null} spinToken={0} emoteToken={0} />);

    rerender(<Turntable skin={5} hat={null} spinToken={1} emoteToken={2} />);
    expect(screen.getByText(/LIVE 3D CHARACTER RENDER/)).toBeInTheDocument();
  });
});
