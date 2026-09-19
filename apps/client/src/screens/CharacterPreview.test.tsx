// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CharacterPreview } from "./CharacterPreview";

const SEQUINCE = [
  { clip: "Win_Start" },
  { clip: "Win_Loop", seconds: 3.2 },
  { clip: "Win_End" },
];

describe("CharacterPreview", () => {
  it("degrades to the RenderSlot caption where WebGL doesn't exist — jsdom has no GPU", () => {
    render(<CharacterPreview color={0} animation="Idle" sub="IDLE" />);

    expect(screen.getByText(/NO 3D PREVIEW/)).toBeInTheDocument();
    expect(screen.getByText(/IDLE/)).toBeInTheDocument();
  });

  it("a sequence, a color change and a spin don't crash the fallback", () => {
    const { rerender } = render(
      <CharacterPreview color={0} animation={SEQUINCE} sub="WINNER CELEBRATION LOOP" />,
    );
    expect(screen.getByText(/WINNER CELEBRATION LOOP/)).toBeInTheDocument();

    rerender(<CharacterPreview color={7} animation={SEQUINCE} spinToken={1} sub="WINNER CELEBRATION LOOP" />);
    expect(screen.getByText(/WINNER CELEBRATION LOOP/)).toBeInTheDocument();
  });

  it("several instances share a screen — the podium renders three", () => {
    render(
      <>
        <CharacterPreview color={null} animation="Idle" sub="FIRST" />
        <CharacterPreview color={null} animation="Idle" sub="SECOND" />
        <CharacterPreview color={null} animation="Idle" sub="THIRD" />
      </>,
    );

    expect(screen.getByText(/FIRST/)).toBeInTheDocument();
    expect(screen.getByText(/SECOND/)).toBeInTheDocument();
    expect(screen.getByText(/THIRD/)).toBeInTheDocument();
  });
});
