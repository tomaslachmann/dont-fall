// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_FAR_DISTANCE, VOICE_FAR_GAIN } from "@dont-fall/shared";
import { writeAudioVolumes } from "../audioSettings.js";
import { writeVoiceSettings } from "../voiceSettings.js";
import { placeVoices, startVoiceSession, stopVoiceSession } from "./session.js";
import type { VoicePlacement, VoicePlayback } from "./playback.js";
import type { VoiceSocketLike } from "./voiceSocket.js";

/** A playback that records what it was told, for the speakers a test says it has heard. */
class FakePlayback implements VoicePlayback {
  /** Whom a chain is open for — a real playback opens one on the first frame from that Account. */
  heard = new Set<string>();
  placements = new Map<string, VoicePlacement>();
  flattened = 0;
  gain = 0;
  closed = false;

  play = (accountId: string, _payload: Uint8Array): void => void this.heard.add(accountId);
  applyPlacements = (placementFor: (accountId: string) => VoicePlacement): void => {
    for (const accountId of this.heard) this.placements.set(accountId, placementFor(accountId));
  };
  flatten = (): void => void (this.flattened += 1);
  drop = (accountId: string): void => void this.heard.delete(accountId);
  setGain = (gain: number): void => void (this.gain = gain);
  close = (): void => void (this.closed = true);
}

/** Looking down −Z from the origin: +X is the listener's right. */
const LISTENER = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };

let playback: FakePlayback;
let stop: (() => void) | null;

const idleSocket = (): VoiceSocketLike => ({
  readyState: 0,
  binaryType: "blob",
  addEventListener: () => {},
  removeEventListener: () => {},
  send: () => {},
  close: () => {},
});

const run = (): void => {
  stop = startVoiceSession({
    // The real one takes its opening gain from the config, as this does —
    // `setGain` is only ever the *change* afterwards.
    createPlayback: (config) => {
      playback.setGain(config.gain);
      return playback;
    },
    startSocket: () => () => {},
  });
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("df_auth_token", "tok");
  playback = new FakePlayback();
  stop = null;
  writeVoiceSettings(localStorage, { scope: "ALL", talkMode: "PUSH TO TALK" });
  vi.stubGlobal("WebSocket", function FakeWebSocket() {
    return idleSocket();
  });
  // jsdom has no Web Audio, so the session builds no chain of its own — the
  // fake above stands in for one through `createPlayback`.
  vi.stubGlobal("AudioContext", function FakeAudioContext() {
    return {
      currentTime: 0,
      destination: {},
      createGain: () => ({ gain: { value: 0 }, connect: () => {}, disconnect: () => {} }),
      createStereoPanner: () => ({ pan: { value: 0 }, connect: () => {}, disconnect: () => {} }),
      createBuffer: () => ({ copyToChannel: () => {} }),
      createBufferSource: () => ({ connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} }),
    };
  });
});

afterEach(() => {
  stop?.();
  stopVoiceSession();
  vi.unstubAllGlobals();
});

describe("placing voices (ADR 0111)", () => {
  it("places each speaker at their Character", () => {
    run();
    playback.play("acc-right", new Uint8Array());
    playback.play("acc-far", new Uint8Array());

    placeVoices({
      listener: LISTENER,
      speakers: new Map([
        ["acc-right", { x: 3, y: 0, z: 0 }],
        ["acc-far", { x: 0, y: 0, z: -VOICE_FAR_DISTANCE * 2 }],
      ]),
    });

    expect(playback.placements.get("acc-right")).toEqual({ gain: 1, pan: 1 });
    // Far off, and still heard: the falloff stops at a floor.
    expect(playback.placements.get("acc-far")).toEqual({ gain: VOICE_FAR_GAIN, pan: 0 });
  });

  it("hears flat anyone the scene has no Character for — a spectator, or someone eliminated", () => {
    run();
    playback.play("acc-watching", new Uint8Array());

    placeVoices({ listener: LISTENER, speakers: new Map([["acc-elsewhere", { x: 9, y: 0, z: 0 }]]) });

    expect(playback.placements.get("acc-watching")).toEqual({ gain: 1, pan: 0 });
  });

  it("flattens everyone when there is no Round drawing", () => {
    run();
    playback.play("acc-a", new Uint8Array());

    placeVoices(null);

    expect(playback.flattened).toBe(1);
    expect(playback.placements.size).toBe(0);
  });

  it("is quiet with no session — a Screen raises nothing, and nothing has to check", () => {
    expect(() => placeVoices(null)).not.toThrow();
    expect(() => placeVoices({ listener: LISTENER, speakers: new Map() })).not.toThrow();
  });
});

describe("the voice volume", () => {
  it("starts at MASTER × VOICE, and follows the sliders live", () => {
    writeAudioVolumes(localStorage, { master: 100, effects: 50, environment: 50, music: 50, voice: 100 });
    run();
    expect(playback.gain).toBe(1);

    writeAudioVolumes(localStorage, { master: 100, effects: 50, environment: 50, music: 50, voice: 0 });

    expect(playback.gain).toBe(0);
  });
});

describe("stopping", () => {
  it("closes the playback chain", () => {
    run();

    stop?.();
    stop = null;

    expect(playback.closed).toBe(true);
  });
});
