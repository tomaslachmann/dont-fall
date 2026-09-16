import { describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { ICE_SURFACE_ID, invalidIceReason, isSegmentIce, moduleHasIceSurface } from "./IceOverlay.js";

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

describe("moduleHasIceSurface (ADR 0066)", () => {
  it("is false for a Module with no Surface anywhere", () => {
    expect(moduleHasIceSurface(mod({ statics: [box(-0.2)] }))).toBe(false);
  });

  it("reads the Module's own Surface — one annotation sheets the deck", () => {
    expect(moduleHasIceSurface(mod({ surface: ICE_SURFACE_ID, statics: [box(-0.2)] }))).toBe(true);
  });

  it("a per-box override wins both ways — the same collapse resolveTrack runs", () => {
    // Icy box on a default Module: sheeted.
    expect(moduleHasIceSurface(mod({ statics: [box(-0.2), box(0.8, ICE_SURFACE_ID)] }))).toBe(true);
    // Muddy box on an icy Module: the only floor is mud, no sheet.
    expect(moduleHasIceSurface(mod({ surface: ICE_SURFACE_ID, statics: [box(-0.2, "mud")] }))).toBe(false);
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
      moduleHasIceSurface(mod({ asset: { meshes: [mesh("default"), mesh(ICE_SURFACE_ID)], solid: [] } })),
    ).toBe(true);
    expect(moduleHasIceSurface(mod({ asset: { meshes: [mesh("default")], solid: [part(ICE_SURFACE_ID)] } }))).toBe(
      true,
    );
    expect(moduleHasIceSurface(mod({ asset: { meshes: [mesh("default")], solid: [part("mud")] } }))).toBe(false);
  });
});

describe("invalidIceReason / isSegmentIce (ADR 0066)", () => {
  it("accepts exactly true — detaching removes the key, mirroring the belt", () => {
    expect(invalidIceReason(true)).toBeUndefined();
    expect(isSegmentIce(true)).toBe(true);
  });

  it("rejects everything else with a reason naming the fix", () => {
    for (const value of [false, 1, "yes", {}, null, undefined]) {
      expect(invalidIceReason(value)).toMatch(/must be true/);
      expect(isSegmentIce(value)).toBe(false);
    }
  });
});
