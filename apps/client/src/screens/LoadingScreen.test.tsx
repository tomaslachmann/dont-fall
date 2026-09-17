// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingScreen } from "./LoadingScreen";

describe("LoadingScreen", () => {
  it("renders a non-interactive wait state", () => {
    render(<LoadingScreen />);

    expect(screen.getByText("Loading next Round…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the Round loader when the next Track is known — screenshot, big name, still no buttons (ADR 0085)", () => {
    const { container } = render(
      <LoadingScreen trackName="Wobble Ramp" thumbnailUrl="http://localhost:8081/tracks/t1/thumbnail" />,
    );

    expect(screen.getByRole("heading", { name: "Wobble Ramp" })).toBeInTheDocument();
    expect(screen.getByText("NEXT ROUND")).toBeInTheDocument();
    expect(screen.getByText("Loading next Round…")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("http://localhost:8081/tracks/t1/thumbnail");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a Track without a screenshot still gets its name big — over the plain surface", () => {
    const { container } = render(<LoadingScreen trackName="Wobble Ramp" />);

    expect(screen.getByRole("heading", { name: "Wobble Ramp" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
