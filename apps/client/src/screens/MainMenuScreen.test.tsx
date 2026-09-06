// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { MainMenuScreen } from "./MainMenuScreen";

function renderAtMenu() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<MainMenuScreen />} />
        <Route path="/play" element={<div>Playing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MainMenuScreen", () => {
  it("renders the wordmark and a Play action", () => {
    renderAtMenu();
    expect(screen.getByText("Don't Fall")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("navigates to /play when Play is clicked", () => {
    renderAtMenu();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByText("Playing")).toBeInTheDocument();
  });
});
