// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MatchOver from "./MatchOver";

describe("MatchOver podium", () => {
  it("stages all three places — celebration, sulk, shrug (fallback captions in jsdom)", () => {
    render(<MatchOver />);

    expect(screen.getByText(/WINNER CELEBRATION LOOP/)).toBeInTheDocument();
    expect(screen.getByText(/SULK POSE/)).toBeInTheDocument();
    expect(screen.getByText(/SHRUG POSE/)).toBeInTheDocument();
    expect(screen.getByText("GOOPY TAKES THE CROWN")).toBeInTheDocument();
  });

  it("a two-Player Match simply has no third plinth", () => {
    render(
      <MatchOver
        podium={[
          { name: "GOOPY", points: 520, pose: "WINNER CELEBRATION LOOP", color: 2, skin: "tiger" },
          { name: "NOODLEBEAN", points: 495, pose: "SULK POSE", color: null },
        ]}
      />,
    );

    expect(screen.getByText(/WINNER CELEBRATION LOOP/)).toBeInTheDocument();
    expect(screen.getByText(/SULK POSE/)).toBeInTheDocument();
    expect(screen.queryByText(/SHRUG POSE/)).toBeNull();
  });
});
