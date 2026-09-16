import { describe, expect, it } from "vitest";
import { GRAVITY_Y } from "../tuning.js";
import { byVolumePriority, holdsAloft, volumeAt, type VolumeConfig } from "./Volume.js";

const volume = (overrides: Partial<VolumeConfig> = {}): VolumeConfig => ({
  bounds: { center: { x: 0, y: 3, z: 0 }, halfExtents: { x: 1.5, y: 3, z: 1.5 } },
  force: { x: 0, y: 40, z: 0 },
  maxInducedSpeed: 10,
  priority: 1,
  ...overrides,
});

describe("byVolumePriority", () => {
  it("puts the highest priority first, keeps ties in authored order, and leaves the input alone", () => {
    const low = volume({ priority: 0 });
    const tieA = volume({ priority: 2 });
    const tieB = volume({ priority: 2 });
    const high = volume({ priority: 5 });
    const authored = [low, tieA, high, tieB];
    expect(byVolumePriority(authored)).toEqual([high, tieA, tieB, low]);
    expect(byVolumePriority(authored)[1]).toBe(tieA);
    expect(authored).toEqual([low, tieA, high, tieB]);
  });
});

describe("volumeAt", () => {
  it("finds the Volume a point is inside, and nothing outside every one", () => {
    const updraft = volume();
    expect(volumeAt([updraft], { x: 0.5, y: 4, z: -1 })).toBe(updraft);
    expect(volumeAt([updraft], { x: 2, y: 4, z: 0 })).toBeUndefined();
    expect(volumeAt([], { x: 0, y: 3, z: 0 })).toBeUndefined();
  });

  it("lets the first in priority order win where Volumes overlap", () => {
    const wind = volume({ force: { x: 20, y: 0, z: 0 }, priority: 3 });
    const updraft = volume();
    expect(volumeAt(byVolumePriority([updraft, wind]), { x: 0, y: 3, z: 0 })).toBe(wind);
  });
});

describe("holdsAloft", () => {
  it("holds a Character up only when the upward push beats gravity", () => {
    expect(holdsAloft(volume())).toBe(true);
    expect(holdsAloft(volume({ force: { x: 0, y: -GRAVITY_Y + 0.5, z: 0 } }))).toBe(true);
    expect(holdsAloft(volume({ force: { x: 0, y: -GRAVITY_Y, z: 0 } }))).toBe(false);
    expect(holdsAloft(volume({ force: { x: 0, y: 10, z: 0 } }))).toBe(false);
    expect(holdsAloft(volume({ force: { x: 30, y: 0, z: 0 } }))).toBe(false);
  });

  it("never for a Volume that may not push at all", () => {
    expect(holdsAloft(volume({ maxInducedSpeed: 0 }))).toBe(false);
  });
});
