import { describe, expect, it } from "vitest";
import { PITCH_MAX, PITCH_MIN } from "./springArm.js";
import { LOOK_SENSITIVITY, applyLook, type Look } from "./lookControls.js";

const look = (yaw = 0, pitch = 0.4): Look => ({ yaw, pitch });

describe("applyLook", () => {
  it("turns the view right (yaw decreases) as the mouse moves right", () => {
    expect(applyLook(look(0), 100, 0).yaw).toBeLessThan(0);
  });

  it("scales rotation by LOOK_SENSITIVITY", () => {
    const next = applyLook(look(1), -10, 0);
    expect(next.yaw).toBeCloseTo(1 + 10 * LOOK_SENSITIVITY, 9);
  });

  it("looks down as the mouse moves down, up as it moves up", () => {
    const start = look(0, 0.4);
    expect(applyLook(start, 0, 50).pitch).toBeGreaterThan(start.pitch);
    expect(applyLook(start, 0, -50).pitch).toBeLessThan(start.pitch);
  });

  it("clamps pitch to the camera's range no matter how far the mouse travels", () => {
    expect(applyLook(look(0, 0), 0, 100_000).pitch).toBe(PITCH_MAX);
    expect(applyLook(look(0, 0), 0, -100_000).pitch).toBe(PITCH_MIN);
  });

  it("never clamps yaw", () => {
    expect(applyLook(look(0), -1_000_000, 0).yaw).toBeGreaterThan(1000);
  });
});
