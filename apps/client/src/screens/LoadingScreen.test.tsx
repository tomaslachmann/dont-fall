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
});
