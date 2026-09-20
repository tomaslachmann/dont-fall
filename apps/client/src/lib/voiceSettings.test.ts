// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TALK_MODE, DEFAULT_VOICE_SCOPE } from "@dont-fall/shared";
import {
  applyLobbyKindToVoiceScope,
  DEFAULT_VOICE_SETTINGS,
  readVoiceSettings,
  subscribeVoiceSettings,
  scopeOnJoiningLobby,
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

  describe("joining a Lobby (ADR 0111)", () => {
    it("drops ALL to PARTY on a public Lobby — an ALL picked for friends never carries to strangers", () => {
      const storage = memoryStorage();
      writeVoiceSettings(storage, { scope: "ALL", talkMode: "OPEN MIC" }, null);

      applyLobbyKindToVoiceScope(storage, true, null);

      // The talk mode is untouched: only who hears you was decided for friends.
      expect(readVoiceSettings(storage)).toEqual({ scope: "PARTY", talkMode: "OPEN MIC" });
    });

    it("leaves a private Lobby's ALL exactly as it is", () => {
      const storage = memoryStorage();
      writeVoiceSettings(storage, { scope: "ALL", talkMode: "PUSH TO TALK" }, null);

      applyLobbyKindToVoiceScope(storage, false, null);

      expect(readVoiceSettings(storage).scope).toBe("ALL");
    });

    it("never turns anything on — OFF and PARTY are left alone in either kind", () => {
      for (const scope of ["OFF", "PARTY"] as const) {
        for (const isPublic of [true, false]) {
          expect(scopeOnJoiningLobby(scope, isPublic)).toBe(scope);
        }
      }
    });

    it("does not wake the session when nothing changed", () => {
      const storage = memoryStorage();
      writeVoiceSettings(storage, { scope: "PARTY", talkMode: "PUSH TO TALK" }, null);
      const listener = vi.fn();
      const target = new EventTarget();
      subscribeVoiceSettings(listener, storage, target);

      applyLobbyKindToVoiceScope(storage, true, target);

      expect(listener).not.toHaveBeenCalled();
    });
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
