// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_VOLUMES_EVENT,
  AUDIO_VOLUMES_STORAGE_KEY,
  DEFAULT_AUDIO_VOLUMES,
  type AudioVolumes,
} from "../lib/audioSettings.js";
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

const slider = (label: string): HTMLInputElement => screen.getByRole("slider", { name: new RegExp(`^${label}`) });
const stored = (): AudioVolumes => JSON.parse(localStorage.getItem(AUDIO_VOLUMES_STORAGE_KEY) ?? "null") as AudioVolumes;

describe("Settings AUDIO tab (ADR 0087, M14 ticket 03)", () => {
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

  it("shows master, effects, environment and music at their defaults, and none of the dead switches", () => {
    renderSettings();
    expect(Number(slider("MASTER").value)).toBe(DEFAULT_AUDIO_VOLUMES.master);
    expect(Number(slider("EFFECTS").value)).toBe(DEFAULT_AUDIO_VOLUMES.effects);
    expect(Number(slider("ENVIRONMENT").value)).toBe(DEFAULT_AUDIO_VOLUMES.environment);
    expect(Number(slider("MUSIC").value)).toBe(DEFAULT_AUDIO_VOLUMES.music);
    expect(screen.queryByText("VOICE CHAT")).toBeNull();
    expect(screen.queryByText("CROWD REACTIONS")).toBeNull();
    expect(screen.queryByText(/IMPACTS/)).toBeNull();
  });

  it("stores a moved slider at once and tells a running game", () => {
    const heard = vi.fn();
    window.addEventListener(AUDIO_VOLUMES_EVENT, heard);
    renderSettings();
    fireEvent.change(slider("MUSIC"), { target: { value: "15" } });
    expect(stored()).toEqual({ ...DEFAULT_AUDIO_VOLUMES, music: 15 });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUDIO_VOLUMES_EVENT, heard);
  });

  it("opens with what this device stored", () => {
    localStorage.setItem(AUDIO_VOLUMES_STORAGE_KEY, JSON.stringify({ ...DEFAULT_AUDIO_VOLUMES, environment: 5 }));
    renderSettings();
    expect(Number(slider("ENVIRONMENT").value)).toBe(5);
  });

  it("RESET returns every slider to its default and stores that", () => {
    localStorage.setItem(AUDIO_VOLUMES_STORAGE_KEY, JSON.stringify({ master: 1, effects: 2, environment: 3, music: 4 }));
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "RESET" }));
    expect(Number(slider("MASTER").value)).toBe(DEFAULT_AUDIO_VOLUMES.master);
    expect(stored()).toEqual(DEFAULT_AUDIO_VOLUMES);
  });
});
