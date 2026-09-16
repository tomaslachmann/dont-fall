import { describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import {
  invalidMudReason,
  isSegmentMud,
  moduleHasMudSurface,
  mudRipplePose,
  mudSloshOffset,
  MUD_RIPPLE_LIFETIME_SECONDS,
  MUD_RIPPLE_MAX_RADIUS,
  MUD_RIPPLE_MIN_RADIUS,
  MUD_RIPPLE_OPACITY,
  MUD_SLOSH_AMPLITUDE_UV,
  MUD_SLOSH_PERIOD_U_SECONDS,
  MUD_SLOSH_PERIOD_V_SECONDS,
  MUD_SURFACE_ID,
} from "./MudOverlay.js";

const box = (centerY: number, surface?: string): Module["statics"][number] => ({
  center: { x: 0, y: centerY, z: 0 },
  halfExtents: { x: 1, y: 0.5, z: 2 },
  ...(surface === undefined ? {} : { surface }),
});

const mod = (partial: Partial<Module>): Module => ({
  id: "test",
  statics: [],
  sockets: [],
  footprint: { bounds: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 0.5, z: 2 } }, clearance: 0.5 },
  ...partial,
});

describe("moduleHasMudSurface (ADR 0067)", () => {
  it("is false for a Module with no Surface anywhere", () => {
    expect(moduleHasMudSurface(mod({ statics: [box(-0.2)] }))).toBe(false);
  });

  it("reads the Module's own Surface — one annotation sheets the deck", () => {
    expect(moduleHasMudSurface(mod({ surface: MUD_SURFACE_ID, statics: [box(-0.2)] }))).toBe(true);
  });

  it("a per-box override wins both ways — the same collapse resolveTrack runs", () => {
    // Muddy box on a default Module: sheeted.
    expect(moduleHasMudSurface(mod({ statics: [box(-0.2), box(0.8, MUD_SURFACE_ID)] }))).toBe(true);
    // Default box on a muddy Module: the only floor is default, no sheet.
    expect(moduleHasMudSurface(mod({ surface: MUD_SURFACE_ID, statics: [box(-0.2, "default")] }))).toBe(false);
  });

  it("reads validated asset meshes and solid parts — their Surfaces arrive already resolved", () => {
    const mesh = (surface: string) => ({ positions: [], indices: [] as number[], surface });
    const part = (surface: string) => ({
      shape: { type: "box", halfExtents: { x: 1, y: 0.5, z: 2 } } as const,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      surface,
    });
    expect(
      moduleHasMudSurface(mod({ asset: { meshes: [mesh("default"), mesh(MUD_SURFACE_ID)], solid: [] } })),
    ).toBe(true);
    expect(moduleHasMudSurface(mod({ asset: { meshes: [mesh("default")], solid: [part(MUD_SURFACE_ID)] } }))).toBe(
      true,
    );
    expect(moduleHasMudSurface(mod({ asset: { meshes: [mesh("default")], solid: [part("ice")] } }))).toBe(false);
  });
});

describe("invalidMudReason / isSegmentMud (ADR 0067)", () => {
  it("accepts exactly true — detaching removes the key, mirroring the belt", () => {
    expect(invalidMudReason(true)).toBeUndefined();
    expect(isSegmentMud(true)).toBe(true);
  });

  it("rejects everything else with a reason naming the fix", () => {
    for (const value of [false, 1, "yes", {}, null, undefined]) {
      expect(invalidMudReason(value)).toMatch(/must be true/);
      expect(isSegmentMud(value)).toBe(false);
    }
  });
});

describe("mudSloshOffset (living mud)", () => {
  it("stays within the amplitude on both axes", () => {
    for (let t = 0; t < 20; t += 0.37) {
      const { u, v } = mudSloshOffset(t, 1.1);
      expect(Math.abs(u)).toBeLessThanOrEqual(MUD_SLOSH_AMPLITUDE_UV);
      expect(Math.abs(v)).toBeLessThanOrEqual(MUD_SLOSH_AMPLITUDE_UV);
    }
  });

  it("repeats per axis on its own period", () => {
    const a = mudSloshOffset(1.7, 0.4);
    expect(mudSloshOffset(1.7 + MUD_SLOSH_PERIOD_U_SECONDS, 0.4).u).toBeCloseTo(a.u, 10);
    expect(mudSloshOffset(1.7 + MUD_SLOSH_PERIOD_V_SECONDS, 0.4).v).toBeCloseTo(a.v, 10);
  });

  it("shifts with the phase — neighbouring sheets never breathe in sync", () => {
    expect(mudSloshOffset(0, 0).u).toBeCloseTo(0, 10);
    expect(mudSloshOffset(0, Math.PI / 2).u).toBeCloseTo(MUD_SLOSH_AMPLITUDE_UV, 10);
  });
});

describe("mudRipplePose (living mud)", () => {
  it("is born small and opaque, dies large and gone", () => {
    expect(mudRipplePose(0)).toEqual({ radius: MUD_RIPPLE_MIN_RADIUS, opacity: MUD_RIPPLE_OPACITY });
    const mid = mudRipplePose(MUD_RIPPLE_LIFETIME_SECONDS / 2)!;
    expect(mid.radius).toBeCloseTo((MUD_RIPPLE_MIN_RADIUS + MUD_RIPPLE_MAX_RADIUS) / 2, 10);
    expect(mid.opacity).toBeCloseTo(MUD_RIPPLE_OPACITY / 2, 10);
    expect(mudRipplePose(MUD_RIPPLE_LIFETIME_SECONDS)).toBeNull();
  });

  it("retires nonsense ages — the pool slot frees instead of drawing garbage", () => {
    expect(mudRipplePose(-0.1)).toBeNull();
    expect(mudRipplePose(Number.NaN)).toBeNull();
    expect(mudRipplePose(MUD_RIPPLE_LIFETIME_SECONDS + 1)).toBeNull();
  });
});
