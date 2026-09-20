import { describe, expect, it, vi } from "vitest";
import {
  applyAudioVolumes,
  AUDIO_VOLUMES_STORAGE_KEY,
  DEFAULT_AUDIO_VOLUMES,
  readAudioVolumes,
  subscribeAudioVolumes,
  voiceGain,
  volumeGain,
  writeAudioVolumes,
} from "./audioSettings.js";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

describe("audio settings (M14 ticket 03, ADR 0087)", () => {
  it("reads the defaults on a fresh device, or without storage", () => {
    expect(readAudioVolumes(memoryStorage())).toEqual(DEFAULT_AUDIO_VOLUMES);
    expect(readAudioVolumes(null)).toEqual(DEFAULT_AUDIO_VOLUMES);
  });

  it("round-trips what was written", () => {
    const storage = memoryStorage();
    const volumes = { master: 50, effects: 10, environment: 0, music: 100, voice: 80 };
    writeAudioVolumes(storage, volumes, null);
    expect(readAudioVolumes(storage)).toEqual(volumes);
  });

  it("falls back per channel on anything missing or broken, and clamps the rest", () => {
    const partial = memoryStorage({ [AUDIO_VOLUMES_STORAGE_KEY]: JSON.stringify({ master: 140, music: "loud", effects: 33.4 }) });
    expect(readAudioVolumes(partial)).toEqual({ ...DEFAULT_AUDIO_VOLUMES, master: 100, effects: 33 });
    expect(readAudioVolumes(memoryStorage({ [AUDIO_VOLUMES_STORAGE_KEY]: "{not json" }))).toEqual(DEFAULT_AUDIO_VOLUMES);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
    expect(readAudioVolumes(throwing)).toEqual(DEFAULT_AUDIO_VOLUMES);
  });

  it("tells this page and other tabs about a change", () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeAudioVolumes(listener, storage, target);

    const volumes = { ...DEFAULT_AUDIO_VOLUMES, music: 0 };
    writeAudioVolumes(storage, volumes, target);
    expect(listener).toHaveBeenLastCalledWith(volumes);

    // Another tab wrote it: this page only sees the storage event.
    storage.setItem(AUDIO_VOLUMES_STORAGE_KEY, JSON.stringify({ ...volumes, master: 5 }));
    target.dispatchEvent(Object.assign(new Event("storage"), { key: AUDIO_VOLUMES_STORAGE_KEY }));
    expect(listener).toHaveBeenLastCalledWith({ ...volumes, master: 5 });

    target.dispatchEvent(Object.assign(new Event("storage"), { key: "something.else" }));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    writeAudioVolumes(storage, DEFAULT_AUDIO_VOLUMES, target);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("maps a slider to a squared gain, silent at 0 and full at 100", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(50)).toBeCloseTo(0.25);
    expect(volumeGain(-5)).toBe(0);
  });

  it("sets every engine bus, leaves VOICE alone, and tolerates no engine", () => {
    const setVolume = vi.fn();
    applyAudioVolumes({ setVolume }, { master: 100, effects: 50, environment: 0, music: 10, voice: 100 });
    // VOICE is not a bus on the Stage's engine (ADR 0111) — it is applied by
    // the voice chain itself, outside every Stage, and handing it here would
    // throw rather than do nothing.
    expect(setVolume.mock.calls).toEqual([
      ["master", 1],
      ["effects", 0.25],
      ["environment", 0],
      ["music", volumeGain(10)],
    ]);
    expect(() => applyAudioVolumes(null, DEFAULT_AUDIO_VOLUMES)).not.toThrow();
  });

  it("is MASTER × VOICE for a voice, as it is MASTER × MUSIC for the music", () => {
    const volumes = { ...DEFAULT_AUDIO_VOLUMES, master: 50, voice: 100, music: 50 };
    expect(voiceGain(volumes)).toBeCloseTo(volumeGain(50) * volumeGain(100), 9);
    expect(voiceGain({ ...volumes, master: 0 })).toBe(0);
    expect(voiceGain({ ...volumes, voice: 0 })).toBe(0);
  });
});
