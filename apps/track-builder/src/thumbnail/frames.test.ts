import { describe, expect, it } from "vitest";
import { AUTO_FRAME_FOV, AUTO_FRAME_TICK, frameTrackAuto } from "./frames.js";

describe("frameTrackAuto", () => {
  it("frames nothing with the default view", () => {
    expect(frameTrackAuto([])).toEqual({
      position: { x: 8, y: 7, z: 14 },
      target: { x: 0, y: 0, z: 0 },
      fov: AUTO_FRAME_FOV,
      tick: AUTO_FRAME_TICK,
    });
  });

  it("looks at one Segment from behind-above the Start side", () => {
    const frame = frameTrackAuto([{ position: { x: 0, y: 0, z: -50 } }]);
    expect(frame.target).toEqual({ x: 0, y: 0, z: -50 });
    expect(frame.position.z).toBeGreaterThan(-50);
    expect(frame.position.y).toBeGreaterThan(0);
    expect(frame.fov).toBe(AUTO_FRAME_FOV);
    expect(frame.tick).toBe(AUTO_FRAME_TICK);
  });

  it("pulls back as the Track grows", () => {
    const near = frameTrackAuto([{ position: { x: 0, y: 0, z: 0 } }]);
    const far = frameTrackAuto([
      { position: { x: 0, y: 0, z: 0 } },
      { position: { x: 0, y: 0, z: -200 } },
    ]);
    expect(far.target).toEqual({ x: 0, y: 0, z: -100 });
    const distance = (frame: typeof near): number =>
      Math.hypot(frame.position.x - frame.target.x, frame.position.y - frame.target.y, frame.position.z - frame.target.z);
    expect(distance(far)).toBeGreaterThan(distance(near) * 5);
  });
});
