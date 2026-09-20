import { describe, expect, it } from "vitest";
import { VOICE_FAR_DISTANCE, VOICE_FAR_GAIN, VOICE_REF_DISTANCE } from "@dont-fall/shared";
import { placementInScene, voiceDistanceGain, voicePlacementFor, type VoiceScene } from "./placement.js";

/** Looking down −Z, the direction a camera behind a Character faces by default. */
const AT_ORIGIN = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };

describe("voiceDistanceGain", () => {
  it("is full inside the reference distance — a bean shoving you is never the quiet one", () => {
    expect(voiceDistanceGain(0)).toBe(1);
    expect(voiceDistanceGain(VOICE_REF_DISTANCE)).toBe(1);
  });

  it("falls to a floor and stays there — a voice across the Track is quiet, never lost", () => {
    expect(voiceDistanceGain(VOICE_FAR_DISTANCE)).toBe(VOICE_FAR_GAIN);
    expect(voiceDistanceGain(VOICE_FAR_DISTANCE * 10)).toBe(VOICE_FAR_GAIN);
    expect(VOICE_FAR_GAIN).toBeGreaterThan(0);
  });

  it("falls, and only falls, in between", () => {
    const midpoint = (VOICE_REF_DISTANCE + VOICE_FAR_DISTANCE) / 2;
    expect(voiceDistanceGain(midpoint)).toBeCloseTo((1 + VOICE_FAR_GAIN) / 2, 9);

    let previous = 1;
    for (let d = VOICE_REF_DISTANCE; d <= VOICE_FAR_DISTANCE; d += 1) {
      const gain = voiceDistanceGain(d);
      expect(gain).toBeLessThanOrEqual(previous);
      previous = gain;
    }
  });
});

describe("voicePlacementFor", () => {
  it("puts someone dead ahead in the middle", () => {
    expect(voicePlacementFor(AT_ORIGIN, { x: 0, y: 0, z: -3 })).toEqual({ gain: 1, pan: 0 });
  });

  it("puts someone to your right on the right, and to your left on the left", () => {
    // Looking down −Z, +X is the listener's right hand.
    expect(voicePlacementFor(AT_ORIGIN, { x: 3, y: 0, z: 0 }).pan).toBeCloseTo(1, 9);
    expect(voicePlacementFor(AT_ORIGIN, { x: -3, y: 0, z: 0 }).pan).toBeCloseTo(-1, 9);
  });

  it("turns with the listener — the same bean swaps ears when you turn around", () => {
    const behind = { ...AT_ORIGIN, forward: { x: 0, y: 0, z: 1 } };

    expect(voicePlacementFor(AT_ORIGIN, { x: 3, y: 0, z: 0 }).pan).toBeCloseTo(1, 9);
    expect(voicePlacementFor(behind, { x: 3, y: 0, z: 0 }).pan).toBeCloseTo(-1, 9);
  });

  it("is half-way over when someone is 45° off, not all the way", () => {
    const pan = voicePlacementFor(AT_ORIGIN, { x: 3, y: 0, z: -3 }).pan;

    expect(pan).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("does not swap your ears when you look at your feet", () => {
    const lookingDown = { ...AT_ORIGIN, forward: { x: 0, y: -1, z: 0 } };

    expect(voicePlacementFor(lookingDown, { x: 3, y: 0, z: 0 }).pan).toBe(0);
  });

  it("ignores height for direction but counts it for distance", () => {
    const high = voicePlacementFor(AT_ORIGIN, { x: 3, y: 40, z: 0 });
    const level = voicePlacementFor(AT_ORIGIN, { x: 3, y: 0, z: 0 });

    expect(high.pan).toBeCloseTo(level.pan, 9);
    expect(high.gain).toBeLessThan(level.gain);
  });

  it("centres someone standing exactly on you rather than dividing by nothing", () => {
    expect(voicePlacementFor(AT_ORIGIN, { x: 0, y: 0, z: 0 })).toEqual({ gain: 1, pan: 0 });
  });

  it("takes a forward that is neither unit length nor level", () => {
    const sloppy = { ...AT_ORIGIN, forward: { x: 0, y: -4, z: -9 } };

    expect(voicePlacementFor(sloppy, { x: 3, y: 0, z: 0 }).pan).toBeCloseTo(1, 9);
  });
});

describe("placementInScene", () => {
  it("places a Character, and leaves anyone without one flat", () => {
    const scene: VoiceScene = {
      listener: AT_ORIGIN,
      speakers: new Map([["acc-near", { x: 3, y: 0, z: 0 }]]),
    };

    expect(placementInScene(scene, "acc-near")).toEqual({ gain: 1, pan: 1 });
    // A spectator, an eliminated Player, or anyone on a Screen (ADR 0111).
    expect(placementInScene(scene, "acc-watching")).toEqual({ gain: 1, pan: 0 });
  });
});
