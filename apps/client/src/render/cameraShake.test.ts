import { describe, expect, it } from "vitest";
import { CameraShake, SCREEN_SHAKE_SCALE, SHAKE_DECAY_PER_S, SHAKE_MAX_OFFSET } from "./cameraShake.js";

describe("CameraShake (ADR 0110)", () => {
  it("jolts after a kick, within the reach at full trauma, and settles as the trauma drains", () => {
    const shake = new CameraShake(SCREEN_SHAKE_SCALE.FULL);
    shake.kick(1);
    let largest = 0;
    for (let n = 0; n < 10; n += 1) {
      const jolt = shake.step(1 / 60);
      largest = Math.max(largest, Math.abs(jolt.x), Math.abs(jolt.y), Math.abs(jolt.z));
    }
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThanOrEqual(SHAKE_MAX_OFFSET);
    expect(shake.step(1 / SHAKE_DECAY_PER_S)).toEqual({ x: 0, y: 0, z: 0, roll: 0 });
  });

  it("does nothing at OFF, and LOW is gentler than FULL", () => {
    const off = new CameraShake(SCREEN_SHAKE_SCALE.OFF);
    off.kick(1);
    expect(off.step(1 / 60)).toEqual({ x: 0, y: 0, z: 0, roll: 0 });

    const peak = (scale: number) => {
      const shake = new CameraShake(scale);
      shake.kick(1);
      let largest = 0;
      for (let n = 0; n < 20; n += 1) largest = Math.max(largest, Math.abs(shake.step(1 / 60).x));
      return largest;
    };
    expect(peak(SCREEN_SHAKE_SCALE.LOW)).toBeLessThan(peak(SCREEN_SHAKE_SCALE.FULL));
  });
});
