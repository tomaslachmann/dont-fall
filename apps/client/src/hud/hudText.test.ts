import { DASH_COOLDOWN_MS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { formatHudText, type HudTextValues } from "./hudText.js";

const base: HudTextValues = {
  roundClock: "3:00",
  phase: "RUNNING",
  tickRateHz: 30,
  fps: 60,
  predictionTick: 123,
  position: { x: 1.2, y: 0.9, z: -3.456 },
  motionState: "Controlled",
  checkpointIndex: null,
  fallCount: 0,
  qualifiedCount: 0,
  connectedPlayers: 2,
  qualified: false,
  placement: null,
  dashCooldownMs: 0,
  netMetricsText: "net rtt 12ms",
};

describe("formatHudText", () => {
  it("byte-matches the exact layout the frame loop used to build inline", () => {
    expect(formatHudText(base)).toBe(
      `DON'T FALL — M2 · predicted + reconciled\n` +
        `time 3:00 · running\n` +
        `sim 30 Hz · render 60 fps · tick 123\n` +
        `pos 1.2, 0.9, -3.5 · Controlled\n` +
        `checkpoint spawn · falls 0 · qualified 0/2\n` +
        `dash [##########] ready\n` +
        `WASD move · Space jump · Shift dash · mouse look\n` +
        `net rtt 12ms`,
    );
  });

  it("lowercases the phase for the status line", () => {
    expect(formatHudText({ ...base, phase: "COUNTDOWN" })).toContain("· countdown\n");
  });

  it("shows 'spawn' before the first Checkpoint, and a 1-based Checkpoint number after", () => {
    expect(formatHudText(base)).toContain("checkpoint spawn");
    expect(formatHudText({ ...base, checkpointIndex: 2 })).toContain("checkpoint #3");
  });

  it("appends no Qualification banner while not Qualified", () => {
    expect(formatHudText(base)).not.toContain("QUALIFIED");
  });

  it("appends QUALIFIED with no number until the server fills in a placement", () => {
    expect(formatHudText({ ...base, qualified: true, placement: null })).toContain("\nQUALIFIED\n");
  });

  it("appends the placement once the server has it", () => {
    expect(formatHudText({ ...base, qualified: true, placement: 1 })).toContain("\nQUALIFIED #1\n");
  });

  it("renders an empty dash bar and no 'ready' suffix at full cooldown", () => {
    expect(formatHudText({ ...base, dashCooldownMs: DASH_COOLDOWN_MS })).toContain("dash [----------]\n");
  });

  it("renders a partially-filled dash bar mid-cooldown, with no 'ready' suffix", () => {
    const text = formatHudText({ ...base, dashCooldownMs: DASH_COOLDOWN_MS / 2 });
    expect(text).toContain("dash [#####-----]\n");
  });

  it("marks the dash bar ready only at zero cooldown", () => {
    expect(formatHudText({ ...base, dashCooldownMs: 0 })).toContain("dash [##########] ready\n");
  });

  it("rounds position to one decimal place", () => {
    expect(formatHudText(base)).toContain("pos 1.2, 0.9, -3.5");
  });
});
