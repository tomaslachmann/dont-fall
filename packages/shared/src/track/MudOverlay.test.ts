import { describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import {
  invalidMudReason,
  isSegmentMud,
  moduleHasMudSurface,
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

