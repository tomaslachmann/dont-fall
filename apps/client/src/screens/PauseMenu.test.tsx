// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NO_AVATAR } from "../lib/avatar.js";
import { DEFAULT_GAMEPLAY_SETTINGS } from "../lib/gameplaySettings.js";
import PauseMenu, { type PauseVoice, type PauseVoicePeer } from "./PauseMenu.js";

const peer = (accountId: string, nickname: string, overrides: Partial<PauseVoicePeer> = {}): PauseVoicePeer => ({
  accountId,
  nickname,
  look: NO_AVATAR,
  speaking: false,
  muted: false,
  ...overrides,
});

const voiceBlock = (overrides: Partial<PauseVoice> = {}): PauseVoice => ({
  scope: "PARTY",
  onScope: () => {},
  peers: [],
  onMute: () => {},
  emptyReason: "Nobody else is here yet.",
  ...overrides,
});

const renderSheet = (props: Partial<Parameters<typeof PauseMenu>[0]> = {}) =>
  render(
    <PauseMenu
      settings={DEFAULT_GAMEPLAY_SETTINGS}
      onChange={() => {}}
      onClose={() => {}}
      onAllSettings={() => {}}
      {...props}
    />,
  );

describe("the pause sheet's Voice chat rows (ADR 0111)", () => {
  it("has no voice rows at all where there is no voice — a Playtest, free roam", () => {
    renderSheet();

    expect(screen.queryByText("VOICE CHAT")).toBeNull();
    expect(screen.queryByText("WHO YOU CAN HEAR")).toBeNull();
  });

  it("shows the scope, and reports a pick", () => {
    const onScope = vi.fn();
    renderSheet({ voice: voiceBlock({ scope: "PARTY", onScope }) });

    expect(screen.getByText("VOICE CHAT")).toBeDefined();
    fireEvent.click(screen.getByText("ALL"));

    expect(onScope).toHaveBeenCalledWith("ALL");
  });

  it("says why the list is empty rather than showing an empty space", () => {
    renderSheet({ voice: voiceBlock({ emptyReason: "Voice chat is off. Pick PARTY or ALL to be heard." }) });

    expect(screen.getByText(/voice chat is off/i)).toBeDefined();
  });

  it("lists one row per linked Player, and mutes from it", () => {
    const onMute = vi.fn();
    renderSheet({ voice: voiceBlock({ peers: [peer("acc-b", "Splatto")], onMute }) });

    expect(screen.getByText("SPLATTO")).toBeDefined();
    // The switch is "can you hear them", so it starts on and turning it off Mutes.
    const hear = screen.getByRole("switch", { name: "Hear Splatto" });
    expect(hear.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(hear);

    expect(onMute).toHaveBeenCalledWith("acc-b", true);
  });

  it("marks a Muted Player, and unmutes from the same row — a Mute must never remove its own way back", () => {
    const onMute = vi.fn();
    renderSheet({ voice: voiceBlock({ peers: [peer("acc-b", "Splatto", { muted: true })], onMute }) });

    expect(screen.getByText("MUTED")).toBeDefined();
    const hear = screen.getByRole("switch", { name: "Hear Splatto" });
    expect(hear.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(hear);

    expect(onMute).toHaveBeenCalledWith("acc-b", false);
  });

  it("wears the speaking halo on whoever is talking", () => {
    const { container } = renderSheet({
      voice: voiceBlock({ peers: [peer("acc-b", "Splatto", { speaking: true }), peer("acc-c", "Wobble")] }),
    });

    expect(container.querySelectorAll("[class*='speaking']")).toHaveLength(1);
  });
});

describe("QUIT MATCH", () => {
  it("is there in a Round", () => {
    renderSheet({ onQuit: () => {} });

    expect(screen.getByText("QUIT MATCH")).toBeDefined();
  });

  it("is not on the Lobby or Standings — there is no Round to walk out of", () => {
    renderSheet();

    expect(screen.queryByText("QUIT MATCH")).toBeNull();
    // ALL SETTINGS stays: it is the way to everything this sheet does not show.
    expect(screen.getByText("ALL SETTINGS")).toBeDefined();
  });
});
