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
import {
  DEFAULT_VOICE_SETTINGS,
  readVoiceSettings,
  VOICE_SETTINGS_EVENT,
  writeVoiceSettings,
} from "../lib/voiceSettings.js";
import { bindingsStorageKey } from "../lib/bindingsStore.js";
import { DEFAULT_BINDINGS } from "@dont-fall/shared";
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

  it("shows every slider at its default, and none of the dead switches", () => {
    renderSettings();
    expect(Number(slider("MASTER").value)).toBe(DEFAULT_AUDIO_VOLUMES.master);
    expect(Number(slider("EFFECTS").value)).toBe(DEFAULT_AUDIO_VOLUMES.effects);
    expect(Number(slider("ENVIRONMENT").value)).toBe(DEFAULT_AUDIO_VOLUMES.environment);
    expect(Number(slider("MUSIC").value)).toBe(DEFAULT_AUDIO_VOLUMES.music);
    // VOICE joined them when voice chat became real (ADR 0111).
    expect(Number(slider("VOICE").value)).toBe(DEFAULT_AUDIO_VOLUMES.voice);
    // CROWD REACTIONS is still a mock with nothing behind it (ADR 0110).
    expect(screen.queryByText("CROWD REACTIONS")).toBeNull();
    expect(screen.queryByText(/IMPACTS/)).toBeNull();
  });

  describe("Voice chat's rows (ADR 0111)", () => {
    it("shows the scope and the talk mode at their defaults", () => {
      renderSettings();

      expect(screen.getByText("VOICE CHAT")).toBeDefined();
      expect(screen.getByText("TALK")).toBeDefined();
      // The mock's own caption, with the key actually bound to `talk`.
      expect(screen.getByText("Push to talk · V")).toBeDefined();
    });

    it("stores a picked scope for this device, and tells a running session", () => {
      const heard = vi.fn();
      window.addEventListener(VOICE_SETTINGS_EVENT, heard);
      renderSettings();

      fireEvent.click(screen.getByText("ALL"));

      expect(readVoiceSettings(localStorage)).toEqual({ ...DEFAULT_VOICE_SETTINGS, scope: "ALL" });
      expect(heard).toHaveBeenCalledTimes(1);
      window.removeEventListener(VOICE_SETTINGS_EVENT, heard);
    });

    it("re-captions itself when the talk mode changes — the row says how you actually talk", () => {
      renderSettings();

      fireEvent.click(screen.getByText("OPEN MIC"));

      expect(screen.queryByText("Push to talk · V")).toBeNull();
      // The caption exactly — "OPEN MIC" also reads off the TALK toggle itself.
      expect(screen.getByText("Open mic · heard whenever you speak")).toBeDefined();
      expect(readVoiceSettings(localStorage).talkMode).toBe("OPEN MIC");
    });

    it("captions with the key the Player actually bound, not the one the design wrote down", () => {
      localStorage.setItem(
        bindingsStorageKey(null),
        JSON.stringify({ ...DEFAULT_BINDINGS, talk: ["KeyB"] }),
      );

      renderSettings();

      expect(screen.getByText("Push to talk · B")).toBeDefined();
    });

    it("says so rather than lying when nothing is bound to talk", () => {
      localStorage.setItem(bindingsStorageKey(null), JSON.stringify({ ...DEFAULT_BINDINGS, talk: [] }));

      renderSettings();

      expect(screen.getByText("Push to talk · no key bound")).toBeDefined();
    });
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
    localStorage.setItem(
      AUDIO_VOLUMES_STORAGE_KEY,
      JSON.stringify({ master: 1, effects: 2, environment: 3, music: 4, voice: 5 }),
    );
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "RESET" }));
    expect(Number(slider("MASTER").value)).toBe(DEFAULT_AUDIO_VOLUMES.master);
    expect(stored()).toEqual(DEFAULT_AUDIO_VOLUMES);
  });

  it("RESET puts Voice chat's own rows back too — they are on this tab", () => {
    writeVoiceSettings(localStorage, { scope: "ALL", talkMode: "OPEN MIC" }, null);
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "RESET" }));

    expect(readVoiceSettings(localStorage)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(screen.getByText("Push to talk · V")).toBeDefined();
  });
});
