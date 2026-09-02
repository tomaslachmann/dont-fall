import type { Module } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { generateRandomTrack } from "./generate.js";

const straightModule = (id: string): Module => ({
  id,
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
  sockets: [
    { id: "entry", type: "floor", position: { x: 0, y: 0, z: 3 }, yaw: Math.PI },
    { id: "exit", type: "floor", position: { x: 0, y: -0.5, z: -3 }, yaw: 0 },
  ],
  footprint: { bounds: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 3, y: 1, z: 3 } }, clearance: 0.5 },
});

describe("generateRandomTrack", () => {
  it("produces a Track with the requested number of Segments", () => {
    const modules = { a: straightModule("a"), b: straightModule("b"), c: straightModule("c") };
    const track = generateRandomTrack(modules, 7);
    expect(track).toHaveLength(7);
  });

  it("only ever picks Modules from the given library", () => {
    const modules = { "only-one": straightModule("only-one") };
    const track = generateRandomTrack(modules, 5);
    expect(track.every((s) => s.moduleId === "only-one")).toBe(true);
  });

  it("chains Segments with no gaps by construction (ADR 0031) — same as chainTrack", () => {
    const modules = { a: straightModule("a"), b: straightModule("b") };
    const track = generateRandomTrack(modules, 3);
    expect(track[0]!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(track[0]!.rotation).toBe(0);
  });

  it("throws when the Module library is empty", () => {
    expect(() => generateRandomTrack({})).toThrow(/empty Module library/);
  });

  it("defaults to a non-trivial length when count is omitted", () => {
    const modules = { a: straightModule("a") };
    const track = generateRandomTrack(modules);
    expect(track.length).toBeGreaterThan(1);
  });
});
