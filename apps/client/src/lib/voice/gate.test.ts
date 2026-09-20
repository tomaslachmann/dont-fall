import { describe, expect, it } from "vitest";
import { VOICE_GATE_HANG_MS, VOICE_GATE_THRESHOLD } from "@dont-fall/shared";
import { frameLevel, OpenMicGate } from "./gate.js";

const LOUD = VOICE_GATE_THRESHOLD * 2;
const QUIET = VOICE_GATE_THRESHOLD / 2;

describe("frameLevel", () => {
  it("is the frame's RMS, so a loud frame reads louder than a quiet one", () => {
    expect(frameLevel(new Float32Array([0, 0, 0, 0]))).toBe(0);
    expect(frameLevel(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 9);
    expect(frameLevel(new Float32Array([0.1, -0.1]))).toBeLessThan(frameLevel(new Float32Array([0.4, -0.4])));
  });

  it("reads an empty frame as silence rather than dividing by nothing", () => {
    expect(frameLevel(new Float32Array())).toBe(0);
  });
});

describe("OpenMicGate", () => {
  it("stays shut through a quiet room", () => {
    const gate = new OpenMicGate();

    expect(gate.open(QUIET, 0)).toBe(false);
    expect(gate.open(QUIET, 1_000)).toBe(false);
  });

  it("opens on the very frame someone speaks — no first syllable is swallowed", () => {
    const gate = new OpenMicGate();

    expect(gate.open(LOUD, 0)).toBe(true);
  });

  it("holds through the gap between two words, and shuts after it", () => {
    const gate = new OpenMicGate();
    gate.open(LOUD, 0);

    expect(gate.open(QUIET, VOICE_GATE_HANG_MS - 1)).toBe(true);
    expect(gate.open(QUIET, VOICE_GATE_HANG_MS)).toBe(false);
  });

  it("restarts the hang on every loud frame, so a long sentence never cuts out mid-way", () => {
    const gate = new OpenMicGate();
    gate.open(LOUD, 0);
    gate.open(LOUD, VOICE_GATE_HANG_MS - 1);

    expect(gate.open(QUIET, VOICE_GATE_HANG_MS * 2 - 2)).toBe(true);
    expect(gate.open(QUIET, VOICE_GATE_HANG_MS * 2 - 1)).toBe(false);
  });

  it("shuts at once when told to, hang time or not", () => {
    const gate = new OpenMicGate();
    gate.open(LOUD, 0);

    gate.close();

    expect(gate.open(QUIET, 1)).toBe(false);
  });

  it("takes its numbers from tuning, and an override for a test", () => {
    const gate = new OpenMicGate({ threshold: 0.5, hangMs: 10 });

    expect(gate.open(0.4, 0)).toBe(false);
    expect(gate.open(0.6, 0)).toBe(true);
    expect(gate.open(0, 9)).toBe(true);
    expect(gate.open(0, 10)).toBe(false);
  });
});
