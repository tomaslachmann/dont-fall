// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRAPHICS_QUALITY_STORAGE_KEY } from "../lib/graphicsQuality.js";
import Settings from "./Settings";

const renderSettings = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const pressed = (): string[] =>
  screen
    .getAllByRole("button", { pressed: true })
    .map((button) => button.textContent ?? "");

describe("Settings VIDEO tab (ADR 0079, M13 ticket 05)", () => {
  beforeEach(() => {
    // A guest: no stored login, so the account query never needs the API.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no API in this test");
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  const openVideo = () => {
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "VIDEO" }));
  };

  it("offers the three levels, with high picked on a fresh device", () => {
    openVideo();
    expect(screen.getByText("GRAPHICS QUALITY")).toBeDefined();
    for (const level of ["HIGH", "MEDIUM", "LOW"]) expect(screen.getByRole("button", { name: level })).toBeDefined();
    expect(pressed()).toEqual(["HIGH"]);
    expect(screen.getByText(/Sharpest picture/)).toBeDefined();
  });

  it("stores a picked level on this device at once", () => {
    openVideo();
    fireEvent.click(screen.getByRole("button", { name: "LOW" }));
    expect(localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY)).toBe("low");
    expect(pressed()).toEqual(["LOW"]);
    expect(screen.getByText(/No shadows or clouds/)).toBeDefined();
  });

  it("shows the level stored earlier", () => {
    localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, "medium");
    openVideo();
    expect(pressed()).toEqual(["MEDIUM"]);
  });

  it("goes back to high on RESET", () => {
    localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, "low");
    openVideo();
    fireEvent.click(screen.getByRole("button", { name: "RESET" }));
    expect(localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY)).toBe("high");
    expect(pressed()).toEqual(["HIGH"]);
  });
});
