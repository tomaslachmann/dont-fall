import { describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { MODULE_STEP } from "./Module.js";
import { chainTrack, resolveTrack } from "./Track.js";
import { M1_MODULES, M1_TRACK } from "./modules.js";

const STRAIGHT: Module = {
  id: "straight",
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
};

const SPINNER_MODULE: Module = {
  id: "spinner-module",
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
  spinners: [{ center: { x: 0, y: 0, z: 0 }, armLength: 2, halfHeight: 0.4, armRadius: 0.3, angularSpeed: 5 }],
  props: [{ shape: { kind: "box", halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }, center: { x: 1, y: 0, z: 0 } }],
  checkpoint: {
    respawn: { x: 0, y: 1, z: 0 },
    volume: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
  },
};

describe("chainTrack", () => {
  it("places each Module MODULE_STEP after the last, starting from `start`", () => {
    const track = chainTrack(["straight", "straight", "straight"], { x: 0, y: 0, z: 10 });

    expect(track).toHaveLength(3);
    expect(track[0]!.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(track[1]!.position).toEqual({
      x: 0 + MODULE_STEP.x,
      y: 0 + MODULE_STEP.y,
      z: 10 + MODULE_STEP.z,
    });
    expect(track[2]!.position).toEqual({
      x: 0 + MODULE_STEP.x * 2,
      y: 0 + MODULE_STEP.y * 2,
      z: 10 + MODULE_STEP.z * 2,
    });
  });

  it("gives every Segment rotation 0 — Tracks are strictly linear (ADR 0030)", () => {
    const track = chainTrack(["straight", "straight"]);
    for (const segment of track) expect(segment.rotation).toBe(0);
  });
});

describe("resolveTrack", () => {
  it("translates every Module's local geometry by its Segment's position", () => {
    const track = chainTrack(["spinner-module"], { x: 5, y: -1, z: 20 });
    const modules = { "spinner-module": SPINNER_MODULE };

    const resolved = resolveTrack(modules, track);

    expect(resolved.statics).toEqual([{ center: { x: 5, y: -1.5, z: 20 }, halfExtents: { x: 3, y: 0.5, z: 3 } }]);
    expect(resolved.spinners[0]!.center).toEqual({ x: 5, y: -1, z: 20 });
    expect(resolved.spinners[0]!.armLength).toBe(2); // tuning passes through untouched
    expect(resolved.props[0]!.center).toEqual({ x: 6, y: -1, z: 20 });
    expect(resolved.checkpoints[0]!.respawn).toEqual({ x: 5, y: 0, z: 20 });
    expect(resolved.checkpoints[0]!.volume.center).toEqual({ x: 5, y: 0, z: 20 });
    expect(resolved.checkpoints[0]!.volume.halfExtents).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("resolves an empty Track to empty arrays", () => {
    expect(resolveTrack({}, [])).toEqual({ statics: [], props: [], spinners: [], checkpoints: [] });
  });

  it("throws if a Segment references an unknown Module", () => {
    const track = chainTrack(["ghost"]);
    expect(() => resolveTrack({}, track)).toThrow(/unknown Module/);
  });

  it("chains any two Module types back-to-back with no compatibility metadata (ADR 0030)", () => {
    const track = chainTrack(["straight", "spinner-module", "straight"]);
    const modules = { straight: STRAIGHT, "spinner-module": SPINNER_MODULE };
    expect(() => resolveTrack(modules, track)).not.toThrow();
  });
});

describe("M1_TRACK (ticket 01 — M1 playground ported to Modules)", () => {
  it("resolves without error and references only known Modules", () => {
    expect(() => resolveTrack(M1_MODULES, M1_TRACK)).not.toThrow();
  });

  it("preserves the same beats as the original playground: 6 stops, 1 Spinner, 3 Props, 2 Checkpoints", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);
    expect(M1_TRACK).toHaveLength(6);
    expect(resolved.spinners).toHaveLength(1);
    expect(resolved.props).toHaveLength(3);
    expect(resolved.checkpoints).toHaveLength(2);
  });

  it("keeps the Spinner's exact M1 tuning (armLength/angularSpeed unchanged by the port)", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);
    expect(resolved.spinners[0]).toMatchObject({ armLength: 2.5, halfHeight: 0.4, armRadius: 0.35, angularSpeed: 6.5 });
  });

  it("places the start platform under the client's PLAYGROUND_SPAWN point", () => {
    const resolved = resolveTrack(M1_MODULES, M1_TRACK);
    const start = resolved.statics[0]!;
    // PLAYGROUND_SPAWN is (0, 1.2, 10.5) — must land within the start platform's footprint.
    expect(Math.abs(0 - start.center.x)).toBeLessThanOrEqual(start.halfExtents.x);
    expect(Math.abs(10.5 - start.center.z)).toBeLessThanOrEqual(start.halfExtents.z);
  });
});
