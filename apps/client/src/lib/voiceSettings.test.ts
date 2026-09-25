// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TALK_MODE, DEFAULT_VOICE_SCOPE } from "@dont-fall/shared";
import {
  DEFAULT_VOICE_SETTINGS,
  readVoiceSettings,
  subscribeVoiceSettings,
  VOICE_SETTINGS_STORAGE_KEY,
  writeVoiceSettings,
} from "./voiceSettings.js";

const memoryStorage = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
};

describe("voice settings (ADR 0111)", () => {
  it("starts at the design's own positions — PARTY, and push to talk", () => {
    expect(DEFAULT_VOICE_SETTINGS).toEqual({ scope: DEFAULT_VOICE_SCOPE, talkMode: DEFAULT_TALK_MODE });
    expect(readVoiceSettings(memoryStorage())).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(readVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("round-trips what was written", () => {
    const storage = memoryStorage();
    writeVoiceSettings(storage, { scope: "ALL", talkMode: "OPEN MIC" }, null);

    expect(readVoiceSettings(storage)).toEqual({ scope: "ALL", talkMode: "OPEN MIC" });
  });

  it("falls back per field on anything missing or not a scope, and never throws", () => {
    const stored = JSON.stringify({ scope: "EVERYONE", talkMode: "OPEN MIC" });
    expect(readVoiceSettings(memoryStorage({ [VOICE_SETTINGS_STORAGE_KEY]: stored }))).toEqual({
      scope: DEFAULT_VOICE_SETTINGS.scope,
      talkMode: "OPEN MIC",
    });
    expect(readVoiceSettings(memoryStorage({ [VOICE_SETTINGS_STORAGE_KEY]: "{not json" }))).toEqual(DEFAULT_VOICE_SETTINGS);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    expect(readVoiceSettings(throwing)).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("still reaches the session when storage refuses it — the change lasts the visit", () => {
    const listener = vi.fn();
    const target = new EventTarget();
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    subscribeVoiceSettings(listener, throwing, target);

    expect(() => writeVoiceSettings(throwing, { scope: "ALL", talkMode: "OPEN MIC" }, target)).not.toThrow();
    expect(listener).toHaveBeenCalledWith({ scope: "ALL", talkMode: "OPEN MIC" });
  });

  it("tells this page and other tabs, and unsubscribes cleanly", () => {
    const storage = memoryStorage();
    const listener = vi.fn();
    const target = new EventTarget();
    const stop = subscribeVoiceSettings(listener, storage, target);

    writeVoiceSettings(storage, { scope: "OFF", talkMode: "PUSH TO TALK" }, target);
    expect(listener).toHaveBeenCalledTimes(1);

    // Another tab writes: only the key's own `storage` event counts.
    target.dispatchEvent(Object.assign(new Event("storage"), { key: "something.else" }));
    expect(listener).toHaveBeenCalledTimes(1);
    target.dispatchEvent(Object.assign(new Event("storage"), { key: VOICE_SETTINGS_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    writeVoiceSettings(storage, { scope: "ALL", talkMode: "OPEN MIC" }, target);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
