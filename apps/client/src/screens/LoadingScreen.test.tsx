// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingScreen, RoundLoader } from "./LoadingScreen";

describe("LoadingScreen (ADR 0105)", () => {
  it("is the design's wait: the Logo over a Stage, a status chip, and nothing to press", () => {
    const { container } = render(<LoadingScreen label="CONNECTING TO THE LOBBY…" />);

    expect(screen.getByRole("img", { name: /DON.T FALL/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("CONNECTING TO THE LOBBY…");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect((container.querySelector("[data-df-feel]") as HTMLElement).style.background).toBe("var(--df-stage-menu)");
  });
});

describe("RoundLoader (ADR 0089, 0105)", () => {
  it("lays the Track's screenshot in as the Stage's field and names the Round, the Track and its mode", () => {
    const { container } = render(
      <RoundLoader
        trackName="SPIN CYCLE"
        thumbnailUrl="http://localhost:8081/tracks/spin-cycle/thumbnail?revision=3"
        round={2}
        rounds={3}
        mode="RACE"
        label="WAITING FOR PLAYERS 3/4"
      />,
    );

    expect(screen.getByRole("heading", { name: "SPIN CYCLE" })).toBeInTheDocument();
    expect(screen.getByText("ROUND 2 OF 3")).toBeInTheDocument();
    expect(screen.getByText("RACE")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("WAITING FOR PLAYERS 3/4");
    const stage = container.querySelector<HTMLElement>("[data-df-feel]")!;
    expect(stage.style.getPropertyValue("--df-track-art")).toBe(
      'url("http://localhost:8081/tracks/spin-cycle/thumbnail?revision=3")',
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the name big on the Lobby's stage when the Track has no screenshot, and leaves out what it cannot know", () => {
    const { container } = render(<RoundLoader trackName="UNREVEALED" label="LOADING TRACK…" />);

    expect(screen.getByRole("heading", { name: "UNREVEALED" })).toBeInTheDocument();
    expect(screen.queryByText(/ROUND \d OF/)).not.toBeInTheDocument();
    expect(container.querySelector<HTMLElement>("[data-df-feel]")!.style.getPropertyValue("--df-track-art")).toBe("");
  });
});
